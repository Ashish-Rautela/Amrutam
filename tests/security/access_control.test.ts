import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Role, VerificationStatus, SlotStatus, ConsultationStatus } from '@prisma/client';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { config } from '../../src/config/index.js';

describe('Security Suite (ABAC, IDOR & Tamper Resistance)', () => {
  const runId = Date.now();
  let patientAUser: any;
  let patientAProfile: any;
  let patientAToken: string;

  let patientBUser: any;
  let patientBProfile: any;
  let patientBToken: string;

  let doctorUser: any;
  let doctorProfile: any;
  let doctorToken: string;

  let testConsultation: any;

  beforeAll(async () => {
    // Patient A
    patientAUser = await prisma.user.create({
      data: {
        email: `sec_pata_${runId}@example.com`,
        phone: `+9199${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.PATIENT,
      },
    });
    patientAProfile = await prisma.patientProfile.create({
      data: { userId: patientAUser.id, fullName: 'Victim Patient A' },
    });
    patientAToken = `Bearer ${jwt.sign(
      { sub: patientAUser.id, email: patientAUser.email, role: Role.PATIENT, patientProfileId: patientAProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // Patient B (Attacker)
    patientBUser = await prisma.user.create({
      data: {
        email: `sec_patb_${runId}@example.com`,
        phone: `+9190${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.PATIENT,
      },
    });
    patientBProfile = await prisma.patientProfile.create({
      data: { userId: patientBUser.id, fullName: 'Attacker Patient B' },
    });
    patientBToken = `Bearer ${jwt.sign(
      { sub: patientBUser.id, email: patientBUser.email, role: Role.PATIENT, patientProfileId: patientBProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // Doctor
    doctorUser = await prisma.user.create({
      data: {
        email: `sec_doc_${runId}@example.com`,
        phone: `+9191${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.DOCTOR,
      },
    });
    doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        fullName: 'Dr. Security Examiner',
        licenseNumber: `SEC-LIC-${runId}`,
        consultationFee: 900,
        verificationStatus: VerificationStatus.VERIFIED,
      },
    });
    doctorToken = `Bearer ${jwt.sign(
      { sub: doctorUser.id, email: doctorUser.email, role: Role.DOCTOR, doctorProfileId: doctorProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // Consultation belonging to Patient A
    const slot = await prisma.availabilitySlot.create({
      data: {
        doctorId: doctorProfile.id,
        startTime: new Date(Date.now() + 130000000),
        endTime: new Date(Date.now() + 130000000 + 1800000),
        status: SlotStatus.BOOKED,
      },
    });

    testConsultation = await prisma.consultation.create({
      data: {
        slotId: slot.id,
        doctorId: doctorProfile.id,
        patientId: patientAProfile.id,
        status: ConsultationStatus.BOOKED,
      },
    });
  });

  afterAll(async () => {
    try {
      await prisma.consultation.deleteMany({
        where: { doctorId: doctorProfile.id },
      });
      await prisma.availabilitySlot.deleteMany({
        where: { doctorId: doctorProfile.id },
      });
      await prisma.doctorProfile.deleteMany({
        where: { id: doctorProfile.id },
      });
      await prisma.patientProfile.deleteMany({
        where: { id: { in: [patientAProfile.id, patientBProfile.id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [patientAUser.id, patientBUser.id, doctorUser.id] } },
      });
    } catch {
      // Ignored
    }
  });

  it('IDOR defense: Patient B cannot view Consultation belonging to Patient A', async () => {
    const res = await request(app)
      .get(`/api/v1/consultations/${testConsultation.id}`)
      .set('Authorization', patientBToken);

    expect(res.status).toBe(403);
  });

  it('IDOR defense: Patient B cannot cancel Consultation belonging to Patient A', async () => {
    const res = await request(app)
      .post(`/api/v1/bookings/${testConsultation.id}/cancel`)
      .set('Authorization', patientBToken)
      .send({ cancellationReason: 'Malicious cancellation attempt' });

    expect(res.status).toBe(403);
  });

  it('Privilege Escalation defense: Patient cannot access admin verification queue', async () => {
    const res = await request(app)
      .get('/api/v1/admin/doctors/pending')
      .set('Authorization', patientAToken);

    expect(res.status).toBe(403);
  });

  it('Tamper defense: Invalid JWT algorithm is rejected (none algorithm exploit)', async () => {
    const fakeToken = jwt.sign(
      { sub: patientAUser.id, role: Role.ADMIN },
      '',
      { algorithm: 'none' as any }
    );

    const res = await request(app)
      .get('/api/v1/admin/analytics/overview')
      .set('Authorization', `Bearer ${fakeToken}`);

    expect(res.status).toBe(401);
  });
});
