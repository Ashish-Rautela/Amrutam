import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Role, VerificationStatus, SlotStatus } from '@prisma/client';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { config } from '../../src/config/index.js';

describe('Concurrency & Race Condition Suite (Booking Collision)', () => {
  const runId = Date.now();
  let doctorUser: any;
  let doctorProfile: any;
  let patientTokens: string[] = [];
  let contestSlot: any;

  beforeAll(async () => {
    // Create doctor
    doctorUser = await prisma.user.create({
      data: {
        email: `race_doc_${runId}@example.com`,
        phone: `+9197${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.DOCTOR,
      },
    });
    doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        fullName: 'Dr. Concurrency Specialist',
        licenseNumber: `RACE-LIC-${runId}`,
        consultationFee: 500,
        verificationStatus: VerificationStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });

    // Create 15 distinct patients
    for (let i = 0; i < 15; i++) {
      const patUser = await prisma.user.create({
        data: {
          email: `race_pat_${runId}_${i}@example.com`,
          phone: `+9198${Math.floor(10000000 + Math.random() * 90000000)}`,
          passwordHash: 'dummy',
          role: Role.PATIENT,
        },
      });
      const patProfile = await prisma.patientProfile.create({
        data: {
          userId: patUser.id,
          fullName: `Contender Patient ${i}`,
        },
      });
      const token = `Bearer ${jwt.sign(
        { sub: patUser.id, email: patUser.email, role: Role.PATIENT, patientProfileId: patProfile.id },
        config.JWT_ACCESS_SECRET,
        { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
      )}`;
      patientTokens.push(token);
    }

    // Single contest slot
    contestSlot = await prisma.availabilitySlot.create({
      data: {
        doctorId: doctorProfile.id,
        startTime: new Date(Date.now() + 120000000),
        endTime: new Date(Date.now() + 120000000 + 1800000),
        status: SlotStatus.AVAILABLE,
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
    } catch {
      // Ignored
    }
  });

  it('guarantees zero double-booking: 15 simultaneous patients race for 1 slot -> exactly 1 succeeds (201) and 14 fail (409)', async () => {
    const promises = patientTokens.map((token) =>
      request(app)
        .post('/api/v1/bookings')
        .set('Authorization', token)
        .send({ slotId: contestSlot.id })
    );

    const responses = await Promise.all(promises);

    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(created.length).toBe(1);
    expect(conflicts.length).toBe(14);

    // Verify slot state
    const slotInDb = await prisma.availabilitySlot.findUnique({
      where: { id: contestSlot.id },
    });
    expect(slotInDb?.status).toBe(SlotStatus.BOOKED);
    expect(slotInDb?.version).toBe(1);

    // Verify exactly one consultation exists in database
    const consultationsInDb = await prisma.consultation.findMany({
      where: { slotId: contestSlot.id },
    });
    expect(consultationsInDb.length).toBe(1);
  });
});
