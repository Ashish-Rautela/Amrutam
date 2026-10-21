import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Role, VerificationStatus, SlotStatus, ConsultationStatus } from '@prisma/client';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { config } from '../../src/config/index.js';

describe('Milestone 3 — Doctor Availability Management (Integration Tests)', () => {
  const runId = Date.now();

  let verifiedDoctorUser: any;
  let verifiedDoctorProfile: any;
  let verifiedDoctorToken: string;

  let secondDoctorUser: any;
  let secondDoctorProfile: any;
  let secondDoctorToken: string;

  let unverifiedDoctorUser: any;
  let unverifiedDoctorProfile: any;
  let unverifiedDoctorToken: string;

  let patientUser: any;
  let patientProfile: any;
  let patientToken: string;

  beforeAll(async () => {
    // 1. Create Verified Doctor 1
    verifiedDoctorUser = await prisma.user.create({
      data: {
        email: `verified_doc_${runId}@example.com`,
        phone: `+9191${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.DOCTOR,
      },
    });
    verifiedDoctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: verifiedDoctorUser.id,
        fullName: 'Dr. Certified Ayurvedic',
        licenseNumber: `CERT-LIC-${runId}-1`,
        consultationFee: 600,
        verificationStatus: VerificationStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });
    verifiedDoctorToken = `Bearer ${jwt.sign(
      { sub: verifiedDoctorUser.id, email: verifiedDoctorUser.email, role: Role.DOCTOR, doctorProfileId: verifiedDoctorProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // 2. Create Verified Doctor 2 (for isolation testing)
    secondDoctorUser = await prisma.user.create({
      data: {
        email: `second_doc_${runId}@example.com`,
        phone: `+9192${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.DOCTOR,
      },
    });
    secondDoctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: secondDoctorUser.id,
        fullName: 'Dr. Second Practitioner',
        licenseNumber: `CERT-LIC-${runId}-2`,
        consultationFee: 800,
        verificationStatus: VerificationStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });
    secondDoctorToken = `Bearer ${jwt.sign(
      { sub: secondDoctorUser.id, email: secondDoctorUser.email, role: Role.DOCTOR, doctorProfileId: secondDoctorProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // 3. Create Unverified Doctor (PENDING status)
    unverifiedDoctorUser = await prisma.user.create({
      data: {
        email: `unverified_doc_${runId}@example.com`,
        phone: `+9193${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.PATIENT, // Still patient
      },
    });
    unverifiedDoctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: unverifiedDoctorUser.id,
        fullName: 'Dr. Pending Verification',
        licenseNumber: `PEND-LIC-${runId}`,
        consultationFee: 400,
        verificationStatus: VerificationStatus.PENDING,
      },
    });
    unverifiedDoctorToken = `Bearer ${jwt.sign(
      { sub: unverifiedDoctorUser.id, email: unverifiedDoctorUser.email, role: Role.PATIENT, doctorProfileId: unverifiedDoctorProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // 4. Create Patient
    patientUser = await prisma.user.create({
      data: {
        email: `patient_avail_${runId}@example.com`,
        phone: `+9194${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.PATIENT,
      },
    });
    patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUser.id,
        fullName: 'Test Patient Patient',
      },
    });
    patientToken = `Bearer ${jwt.sign(
      { sub: patientUser.id, email: patientUser.email, role: Role.PATIENT, patientProfileId: patientProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;
  });

  afterAll(async () => {
    const userIds = [verifiedDoctorUser?.id, secondDoctorUser?.id, unverifiedDoctorUser?.id, patientUser?.id].filter(Boolean);
    const doctorProfileIds = [verifiedDoctorProfile?.id, secondDoctorProfile?.id, unverifiedDoctorProfile?.id].filter(Boolean);

    await prisma.consultation.deleteMany({ where: { doctorId: { in: doctorProfileIds } } });
    await prisma.availabilitySlot.deleteMany({ where: { doctorId: { in: doctorProfileIds } } });
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.patientProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.doctorProfile.deleteMany({ where: { id: { in: doctorProfileIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe('1. Availability Permission & Authorization Guardrails', () => {
    it('should forbid unverified doctors from publishing availability slots', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const start = new Date(tomorrow.setHours(9, 0, 0, 0)).toISOString();
      const end = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', unverifiedDoctorToken)
        .send({ startTime: start, endTime: end });

      // Unverified doctor role is PATIENT, so authorizeRoles(Role.DOCTOR) rejects with 403
      expect(res.status).toBe(403);
      expect(res.body.detail).toContain('Access denied');
    });

    it('should forbid patients from creating availability slots', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const start = new Date(tomorrow.setHours(9, 0, 0, 0)).toISOString();
      const end = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', patientToken)
        .send({ startTime: start, endTime: end });

      expect(res.status).toBe(403);
    });

    it('should reject unauthenticated requests to slot creation', async () => {
      const res = await request(app)
        .post('/api/v1/availability/slots')
        .send({});

      expect(res.status).toBe(401);
    });
  });

  describe('2. Time Validation & Boundary Rules', () => {
    it('should reject slots with end time earlier than or equal to start time', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const start = new Date(tomorrow.setHours(11, 0, 0, 0)).toISOString();
      const end = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: start, endTime: end });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body)).toContain('Slot end time must be strictly after start time');
    });

    it('should reject slots scheduled in the past', async () => {
      const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
      const start = new Date(yesterday.setHours(10, 0, 0, 0)).toISOString();
      const end = new Date(yesterday.setHours(11, 0, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: start, endTime: end });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('cannot schedule availability slots in the past');
    });

    it('should reject slots with duration less than 10 minutes', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const start = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();
      const end = new Date(tomorrow.setHours(10, 5, 0, 0)).toISOString(); // 5 mins

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: start, endTime: end });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('at least 10 minutes');
    });

    it('should reject slots with duration exceeding 4 hours', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const start = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();
      const end = new Date(tomorrow.setHours(15, 0, 0, 0)).toISOString(); // 5 hours

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: start, endTime: end });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('cannot exceed 4 hours');
    });

    it('should reject a batch of slots containing internal self-overlaps', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const s1 = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();
      const e1 = new Date(tomorrow.setHours(11, 0, 0, 0)).toISOString();

      const s2 = new Date(tomorrow.setHours(10, 30, 0, 0)).toISOString(); // overlaps with s1
      const e2 = new Date(tomorrow.setHours(11, 30, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({
          slots: [
            { startTime: s1, endTime: e1 },
            { startTime: s2, endTime: e2 },
          ],
        });

      expect(res.status).toBe(400);
      expect(res.body.detail).toContain('overlapping slots');
    });
  });

  describe('3. Sequential Non-Overlapping Slot Creation & Database Exclusion Constraint', () => {
    let slot1Id: string;
    let slot2Id: string;

    it('should allow creating consecutive non-overlapping slots', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const s1 = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();
      const e1 = new Date(tomorrow.setHours(11, 0, 0, 0)).toISOString();

      const s2 = new Date(tomorrow.setHours(11, 0, 0, 0)).toISOString(); // adjacent
      const e2 = new Date(tomorrow.setHours(12, 0, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({
          slots: [
            { startTime: s1, endTime: e1 },
            { startTime: s2, endTime: e2 },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.data.length).toBe(2);
      slot1Id = res.body.data[0].id;
      slot2Id = res.body.data[1].id;
    });

    it('should reject overlapping slot overlapping end of slot 1 and start of slot 2 (PostgreSQL exclusion)', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const s = new Date(tomorrow.setHours(10, 30, 0, 0)).toISOString();
      const e = new Date(tomorrow.setHours(11, 30, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: s, endTime: e });

      expect(res.status).toBe(409);
      expect(res.body.detail).toContain('overlap with an existing slot');
    });

    it('should reject slot completely enclosing an existing slot', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const s = new Date(tomorrow.setHours(9, 30, 0, 0)).toISOString();
      const e = new Date(tomorrow.setHours(11, 30, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: s, endTime: e });

      expect(res.status).toBe(409);
      expect(res.body.detail).toContain('overlap with an existing slot');
    });

    it('should allow a different doctor to create a slot for the exact same time window (doctor isolation)', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const s = new Date(tomorrow.setHours(10, 0, 0, 0)).toISOString();
      const e = new Date(tomorrow.setHours(11, 0, 0, 0)).toISOString();

      // Doctor 2 can practice at the same time
      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', secondDoctorToken)
        .send({ startTime: s, endTime: e });

      expect(res.status).toBe(201);
    });
  });

  describe('4. Concurrency Protection against Overlapping Slots', () => {
    it('should safely serialize concurrent requests attempting to create overlapping slots (exact one succeeds)', async () => {
      const dayAfterTomorrow = new Date(Date.now() + 48 * 3600 * 1000);
      const s = new Date(dayAfterTomorrow.setHours(14, 0, 0, 0)).toISOString();
      const e = new Date(dayAfterTomorrow.setHours(15, 0, 0, 0)).toISOString();

      // Fire two concurrent creation requests simultaneously
      const [res1, res2] = await Promise.all([
        request(app)
          .post('/api/v1/availability/slots')
          .set('Authorization', verifiedDoctorToken)
          .send({ startTime: s, endTime: e }),
        request(app)
          .post('/api/v1/availability/slots')
          .set('Authorization', verifiedDoctorToken)
          .send({ startTime: s, endTime: e }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      // Exactly one succeeds with 201, one is blocked by PostgreSQL exclusion constraint with 409
      expect(statuses).toEqual([201, 409]);

      // Assert PostgreSQL DB state: Exactly one slot exists for this window
      const count = await prisma.availabilitySlot.count({
        where: {
          doctorId: verifiedDoctorProfile.id,
          startTime: new Date(s),
          endTime: new Date(e),
          status: SlotStatus.AVAILABLE,
        },
      });
      expect(count).toBe(1);
    });
  });

  describe('5. Availability Listing & Public Querying', () => {
    it('should allow doctor to list their own slots with pagination', async () => {
      const res = await request(app)
        .get('/api/v1/availability/my-slots')
        .set('Authorization', verifiedDoctorToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
      expect(res.body.pagination).toBeDefined();

      // Ownership isolation: slots belong exclusively to this doctor
      for (const slot of res.body.data) {
        expect(slot.doctorId).toBe(verifiedDoctorProfile.id);
      }
    });

    it('should allow public user to query available slots for an approved doctor by date range', async () => {
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000);
      const startDate = new Date(tomorrow.setHours(0, 0, 0, 0)).toISOString();
      const endDate = new Date(tomorrow.setHours(23, 59, 59, 999)).toISOString();

      const res = await request(app)
        .get(`/api/v1/availability/doctors/${verifiedDoctorProfile.id}?startDate=${startDate}&endDate=${endDate}`);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);

      for (const slot of res.body.data) {
        expect(slot.status).toBe(SlotStatus.AVAILABLE);
        expect(new Date(slot.startTime).getTime()).toBeGreaterThanOrEqual(new Date(startDate).getTime());
      }
    });
  });

  describe('6. Slot Modification & Ownership Enforcement', () => {
    let modifiableSlotId: string;

    beforeAll(async () => {
      const threeDaysLater = new Date(Date.now() + 72 * 3600 * 1000);
      const s = new Date(threeDaysLater.setHours(9, 0, 0, 0)).toISOString();
      const e = new Date(threeDaysLater.setHours(10, 0, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: s, endTime: e });

      modifiableSlotId = res.body.data[0].id;
    });

    it('should forbid Doctor 2 from updating Doctor 1 slot (ownership isolation)', async () => {
      const res = await request(app)
        .patch(`/api/v1/availability/slots/${modifiableSlotId}`)
        .set('Authorization', secondDoctorToken)
        .send({ status: SlotStatus.AVAILABLE });

      expect(res.status).toBe(403);
      expect(res.body.detail).toContain('permission to modify');
    });

    it('should allow Doctor 1 to adjust time boundaries of their own eligible slot', async () => {
      const threeDaysLater = new Date(Date.now() + 72 * 3600 * 1000);
      const newStart = new Date(threeDaysLater.setHours(9, 15, 0, 0)).toISOString();
      const newEnd = new Date(threeDaysLater.setHours(10, 0, 0, 0)).toISOString();

      const res = await request(app)
        .patch(`/api/v1/availability/slots/${modifiableSlotId}`)
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: newStart, endTime: newEnd });

      expect(res.status).toBe(200);
      expect(res.body.data.startTime).toBe(new Date(newStart).toISOString());
    });
  });

  describe('7. Consultation Association & Immutability Protection', () => {
    let bookedSlotId: string;
    let consultationId: string;

    beforeAll(async () => {
      const fourDaysLater = new Date(Date.now() + 96 * 3600 * 1000);
      const s = new Date(fourDaysLater.setHours(10, 0, 0, 0)).toISOString();
      const e = new Date(fourDaysLater.setHours(11, 0, 0, 0)).toISOString();

      const slotRes = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: s, endTime: e });

      bookedSlotId = slotRes.body.data[0].id;

      // Associate slot with a consultation
      const consultation = await prisma.consultation.create({
        data: {
          slotId: bookedSlotId,
          doctorId: verifiedDoctorProfile.id,
          patientId: patientProfile.id,
          status: ConsultationStatus.BOOKED,
        },
      });
      consultationId = consultation.id;
    });

    it('should prevent modifying a slot associated with an active booked consultation', async () => {
      const res = await request(app)
        .patch(`/api/v1/availability/slots/${bookedSlotId}`)
        .set('Authorization', verifiedDoctorToken)
        .send({ status: SlotStatus.AVAILABLE });

      expect(res.status).toBe(409);
      expect(res.body.detail).toContain('already booked');
    });

    it('should prevent cancelling a slot associated with an active booked consultation', async () => {
      const res = await request(app)
        .delete(`/api/v1/availability/slots/${bookedSlotId}`)
        .set('Authorization', verifiedDoctorToken);

      expect(res.status).toBe(409);
      expect(res.body.detail).toContain('already booked');
    });
  });

  describe('8. Slot Cancellation & Re-scheduling', () => {
    let cancellableSlotId: string;
    let cancelSlotStart: string;
    let cancelSlotEnd: string;

    beforeAll(async () => {
      const fiveDaysLater = new Date(Date.now() + 120 * 3600 * 1000);
      cancelSlotStart = new Date(fiveDaysLater.setHours(16, 0, 0, 0)).toISOString();
      cancelSlotEnd = new Date(fiveDaysLater.setHours(17, 0, 0, 0)).toISOString();

      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: cancelSlotStart, endTime: cancelSlotEnd });

      cancellableSlotId = res.body.data[0].id;
    });

    it('should allow doctor to cancel an unbooked availability slot', async () => {
      const res = await request(app)
        .delete(`/api/v1/availability/slots/${cancellableSlotId}`)
        .set('Authorization', verifiedDoctorToken);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(SlotStatus.CANCELLED);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          actorId: verifiedDoctorUser.id,
          action: 'AVAILABILITY_SLOT_CANCELLED',
          resourceId: cancellableSlotId,
        },
      });
      expect(audit).not.toBeNull();
    });

    it('should permit re-scheduling the same time interval once the previous slot is CANCELLED (PostgreSQL exclusion condition)', async () => {
      // Because exclusion constraint specifies WHERE (status != 'CANCELLED'),
      // creating a new slot for the exact same interval should now succeed!
      const res = await request(app)
        .post('/api/v1/availability/slots')
        .set('Authorization', verifiedDoctorToken)
        .send({ startTime: cancelSlotStart, endTime: cancelSlotEnd });

      expect(res.status).toBe(201);
      expect(res.body.data.length).toBe(1);
      expect(res.body.data[0].status).toBe(SlotStatus.AVAILABLE);
    });
  });
});
