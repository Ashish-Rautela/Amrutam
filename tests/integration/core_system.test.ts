import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import {
  Role,
  VerificationStatus,
  SlotStatus,
  ConsultationStatus,
  PaymentStatus,
  OutboxStatus,
} from '@prisma/client';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { config } from '../../src/config/index.js';
import { outboxWorker } from '../../src/worker/outbox.worker.js';

describe('Amrutam Core System Implementation (End-to-End Integration Tests)', () => {
  const runId = Date.now();

  let doctorUser: any;
  let doctorProfile: any;
  let doctorToken: string;

  let patientUser: any;
  let patientProfile: any;
  let patientToken: string;

  let otherPatientUser: any;
  let otherPatientProfile: any;
  let otherPatientToken: string;

  let adminUser: any;
  let adminToken: string;

  let slot1: any;
  let slot2: any;
  let slot3: any;
  let raceSlot: any;

  beforeAll(async () => {
    // 1. Create Verified Doctor
    doctorUser = await prisma.user.create({
      data: {
        email: `core_doc_${runId}@example.com`,
        phone: `+9193${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.DOCTOR,
      },
    });
    doctorProfile = await prisma.doctorProfile.create({
      data: {
        userId: doctorUser.id,
        fullName: 'Dr. Siddharth Varma',
        licenseNumber: `CORE-LIC-${runId}`,
        consultationFee: 750,
        verificationStatus: VerificationStatus.VERIFIED,
        verifiedAt: new Date(),
      },
    });
    doctorToken = `Bearer ${jwt.sign(
      { sub: doctorUser.id, email: doctorUser.email, role: Role.DOCTOR, doctorProfileId: doctorProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // 2. Create Patient 1
    patientUser = await prisma.user.create({
      data: {
        email: `core_pat_${runId}@example.com`,
        phone: `+9194${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.PATIENT,
      },
    });
    patientProfile = await prisma.patientProfile.create({
      data: {
        userId: patientUser.id,
        fullName: 'Rohit Kulkarni',
      },
    });
    patientToken = `Bearer ${jwt.sign(
      { sub: patientUser.id, email: patientUser.email, role: Role.PATIENT, patientProfileId: patientProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // 3. Create Patient 2 (for unauthorized access tests)
    otherPatientUser = await prisma.user.create({
      data: {
        email: `other_pat_${runId}@example.com`,
        phone: `+9195${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.PATIENT,
      },
    });
    otherPatientProfile = await prisma.patientProfile.create({
      data: {
        userId: otherPatientUser.id,
        fullName: 'Ananya Deshmukh',
      },
    });
    otherPatientToken = `Bearer ${jwt.sign(
      { sub: otherPatientUser.id, email: otherPatientUser.email, role: Role.PATIENT, patientProfileId: otherPatientProfile.id },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // 4. Create Admin
    adminUser = await prisma.user.create({
      data: {
        email: `core_admin_${runId}@example.com`,
        phone: `+9196${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy',
        role: Role.ADMIN,
      },
    });
    adminToken = `Bearer ${jwt.sign(
      { sub: adminUser.id, email: adminUser.email, role: Role.ADMIN },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // 5. Create Availability Slots for Doctor
    const now = Date.now();
    slot1 = await prisma.availabilitySlot.create({
      data: {
        doctorId: doctorProfile.id,
        startTime: new Date(now + 86400000), // +1 day
        endTime: new Date(now + 86400000 + 1800000), // +30m
        status: SlotStatus.AVAILABLE,
      },
    });

    slot2 = await prisma.availabilitySlot.create({
      data: {
        doctorId: doctorProfile.id,
        startTime: new Date(now + 90000000),
        endTime: new Date(now + 90000000 + 1800000),
        status: SlotStatus.AVAILABLE,
      },
    });

    slot3 = await prisma.availabilitySlot.create({
      data: {
        doctorId: doctorProfile.id,
        startTime: new Date(now + 93600000),
        endTime: new Date(now + 93600000 + 1800000),
        status: SlotStatus.AVAILABLE,
      },
    });

    raceSlot = await prisma.availabilitySlot.create({
      data: {
        doctorId: doctorProfile.id,
        startTime: new Date(now + 97200000),
        endTime: new Date(now + 97200000 + 1800000),
        status: SlotStatus.AVAILABLE,
      },
    });
  });

  afterAll(async () => {
    // Clean up created records cleanly
    try {
      await prisma.prescriptionItem.deleteMany({
        where: { prescription: { doctorId: doctorProfile.id } },
      });
      await prisma.prescription.deleteMany({
        where: { doctorId: doctorProfile.id },
      });
      await prisma.payment.deleteMany({
        where: { consultation: { doctorId: doctorProfile.id } },
      });
      await prisma.consultationConsent.deleteMany({
        where: { consultation: { doctorId: doctorProfile.id } },
      });
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
        where: { id: { in: [patientProfile.id, otherPatientProfile.id] } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: [doctorUser.id, patientUser.id, otherPatientUser.id, adminUser.id] } },
      });
    } catch {
      // Ignored in test cleanup
    }
  });

  // --------------------------------------------------------------------------
  // Phase 1: Appointment Booking & Slot Reservation
  // --------------------------------------------------------------------------
  describe('Phase 1: Appointment Booking, Idempotency & Concurrency', () => {
    let createdConsultationId: string;

    it('should successfully book an available slot and emit outbox event', async () => {
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', patientToken)
        .send({
          slotId: slot1.id,
          mode: 'VIDEO',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe(ConsultationStatus.BOOKED);
      expect(res.body.data.mode).toBe('VIDEO');
      expect(res.body.data.meetingRoomId).toBeDefined();

      createdConsultationId = res.body.data.id;

      // Verify slot status in DB
      const updatedSlot = await prisma.availabilitySlot.findUnique({ where: { id: slot1.id } });
      expect(updatedSlot?.status).toBe(SlotStatus.BOOKED);

      // Verify transactional outbox event
      const outbox = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'CONSULTATION',
          aggregateId: createdConsultationId,
          eventType: 'BOOKING_CREATED',
        },
      });
      expect(outbox).not.toBeNull();
    });

    it('should prevent doctor from booking their own availability slot (self-booking guard)', async () => {
      // Attempt self-booking with doctor's own slot
      const res = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', doctorToken)
        .send({
          slotId: slot2.id,
        });

      // Role check: DOCTOR is not PATIENT or ADMIN
      expect(res.status).toBe(403);
    });

    it('should handle idempotent booking creation correctly with Idempotency-Key', async () => {
      const idempotencyKey = `idem_${runId}_${crypto.randomBytes(4).toString('hex')}`;
      const payload = { slotId: slot2.id, mode: 'AUDIO' };

      // First request
      const firstRes = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', patientToken)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(firstRes.status).toBe(201);
      const firstBookingId = firstRes.body.data.id;

      // Replayed request with identical key and payload
      const secondRes = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', patientToken)
        .set('Idempotency-Key', idempotencyKey)
        .send(payload);

      expect(secondRes.status).toBe(201);
      expect(secondRes.body.data.id).toBe(firstBookingId);
      expect(secondRes.headers['x-cache-lookup']).toBe('HIT');

      // Replayed request with DIFFERENT payload but SAME key must fail
      const conflictRes = await request(app)
        .post('/api/v1/bookings')
        .set('Authorization', patientToken)
        .set('Idempotency-Key', idempotencyKey)
        .send({ slotId: slot3.id, mode: 'VIDEO' });

      expect(conflictRes.status).toBe(400);
      expect(conflictRes.body.detail || conflictRes.body.message).toContain('reused with different request payload');
    });

    it('should guarantee atomic concurrency: exactly 1 booking succeeds when 10 concurrent requests target the same slot', async () => {
      const concurrentRequests = Array.from({ length: 10 }).map(() =>
        request(app)
          .post('/api/v1/bookings')
          .set('Authorization', patientToken)
          .send({ slotId: raceSlot.id })
      );

      const responses = await Promise.all(concurrentRequests);
      const successCount = responses.filter((r) => r.status === 201).length;
      const conflictCount = responses.filter((r) => r.status === 409).length;

      expect(successCount).toBe(1);
      expect(conflictCount).toBe(9);

      // Verify in DB that only one consultation exists for raceSlot
      const slotConsultations = await prisma.consultation.findMany({
        where: { slotId: raceSlot.id },
      });
      expect(slotConsultations.length).toBe(1);
    });

    it('should cancel a booking and update slot status to CANCELLED', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${createdConsultationId}/cancel`)
        .set('Authorization', patientToken)
        .send({ cancellationReason: 'Personal emergency arose' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(ConsultationStatus.CANCELLED);
      expect(res.body.data.cancellationReason).toBe('Personal emergency arose');

      const updatedSlot = await prisma.availabilitySlot.findUnique({ where: { id: slot1.id } });
      expect(updatedSlot?.status).toBe(SlotStatus.CANCELLED);
    });

    it('should reject cancelling an already cancelled booking', async () => {
      const res = await request(app)
        .post(`/api/v1/bookings/${createdConsultationId}/cancel`)
        .set('Authorization', patientToken)
        .send({ cancellationReason: 'Trying to cancel again' });

      expect(res.status).toBe(400);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 2: Consultation Lifecycle, Explicit Consent & Prescriptions
  // --------------------------------------------------------------------------
  describe('Phase 2: Consultation State Machine, Mandatory Consent & Prescriptions', () => {
    let consultation: any;
    let initialPrescriptionId: string;

    beforeAll(async () => {
      // Create a fresh booked consultation for this block
      const slotForConsultation = await prisma.availabilitySlot.create({
        data: {
          doctorId: doctorProfile.id,
          startTime: new Date(Date.now() + 100000000),
          endTime: new Date(Date.now() + 100000000 + 1800000),
          status: SlotStatus.BOOKED,
        },
      });

      consultation = await prisma.consultation.create({
        data: {
          slotId: slotForConsultation.id,
          doctorId: doctorProfile.id,
          patientId: patientProfile.id,
          status: ConsultationStatus.BOOKED,
          mode: 'VIDEO',
        },
      });
    });

    it('should block starting consultation if patient consent has NOT been recorded', async () => {
      const res = await request(app)
        .post(`/api/v1/consultations/${consultation.id}/start`)
        .set('Authorization', doctorToken);

      expect(res.status).toBe(400);
      expect(res.body.detail || res.body.message).toContain('Explicit patient consent must be recorded');
    });

    it('should successfully record patient consent with client IP and user agent', async () => {
      const res = await request(app)
        .post(`/api/v1/consultations/${consultation.id}/consent`)
        .set('Authorization', patientToken)
        .set('User-Agent', 'Vitest-Amrutam-Mobile/1.0')
        .send({
          granted: true,
          consentType: 'TELEMEDICINE_CONSULTATION',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.consentRecorded).toBe(true);

      const consentRecord = await prisma.consultationConsent.findUnique({
        where: { consultationId: consultation.id },
      });
      expect(consentRecord).not.toBeNull();
      expect(consentRecord?.granted).toBe(true);
      expect(consentRecord?.userAgent).toBe('Vitest-Amrutam-Mobile/1.0');
    });

    it('should prevent other patient from recording consent for a consultation they do not own', async () => {
      const res = await request(app)
        .post(`/api/v1/consultations/${consultation.id}/consent`)
        .set('Authorization', otherPatientToken)
        .send({
          granted: true,
        });

      expect(res.status).toBe(403);
    });

    it('should allow doctor to start consultation once consent is recorded', async () => {
      const res = await request(app)
        .post(`/api/v1/consultations/${consultation.id}/start`)
        .set('Authorization', doctorToken);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(ConsultationStatus.IN_PROGRESS);
    });

    it('should issue a versioned prescription with doctor digital signature', async () => {
      const prescriptionData = {
        diagnosis: 'Vata-Pitta imbalance with chronic fatigue and insomnia',
        advice: 'Take medicines after meals with warm water. Practice Pranayama for 15 mins daily.',
        items: [
          {
            medicineName: 'Ashwagandha Churna',
            dosage: '3g',
            frequency: 'Twice daily with warm milk',
            durationDays: 30,
            instructions: 'Before sleeping and after breakfast',
          },
          {
            medicineName: 'Brahmi Vati',
            dosage: '1 tablet',
            frequency: 'Once daily',
            durationDays: 15,
          },
        ],
      };

      const res = await request(app)
        .post(`/api/v1/consultations/${consultation.id}/prescriptions`)
        .set('Authorization', doctorToken)
        .send(prescriptionData);

      expect(res.status).toBe(201);
      expect(res.body.data.version).toBe(1);
      expect(res.body.data.doctorSignature).toBeDefined();
      expect(res.body.data.items.length).toBe(2);

      initialPrescriptionId = res.body.data.id;
    });

    it('should issue an amended prescription revision preserving immutability', async () => {
      const amendmentData = {
        diagnosis: 'Vata-Pitta imbalance with acute migraine flare',
        parentPrescriptionId: initialPrescriptionId,
        amendmentReason: 'Patient reported sensitivity to Brahmi Vati; substituting with Shankhpushpi',
        items: [
          {
            medicineName: 'Ashwagandha Churna',
            dosage: '3g',
            frequency: 'Twice daily with warm milk',
            durationDays: 30,
          },
          {
            medicineName: 'Shankhpushpi Syrup',
            dosage: '10ml',
            frequency: 'Twice daily',
            durationDays: 20,
          },
        ],
      };

      const res = await request(app)
        .post(`/api/v1/consultations/${consultation.id}/prescriptions`)
        .set('Authorization', doctorToken)
        .send(amendmentData);

      expect(res.status).toBe(201);
      expect(res.body.data.version).toBe(2);
      expect(res.body.data.parentPrescriptionId).toBe(initialPrescriptionId);
      expect(res.body.data.amendmentReason).toContain('substituting with Shankhpushpi');

      // Verify that version 1 still exists intact in the database
      const v1 = await prisma.prescription.findUnique({ where: { id: initialPrescriptionId } });
      expect(v1?.version).toBe(1);
    });

    it('should prevent patient from issuing a prescription', async () => {
      const res = await request(app)
        .post(`/api/v1/consultations/${consultation.id}/prescriptions`)
        .set('Authorization', patientToken)
        .send({
          diagnosis: 'Self diagnosis',
          items: [{ medicineName: 'Triphala', dosage: '5g', frequency: 'daily', durationDays: 7 }],
        });

      expect(res.status).toBe(403);
    });

    it('should complete consultation with clinical notes and record outbox event', async () => {
      const res = await request(app)
        .post(`/api/v1/consultations/${consultation.id}/complete`)
        .set('Authorization', doctorToken)
        .send({
          clinicalNotes: 'Patient responded well to herbal protocol. Recommended follow-up in 4 weeks.',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(ConsultationStatus.COMPLETED);
      expect(res.body.data.clinicalNotes).toContain('Recommended follow-up in 4 weeks');

      const outbox = await prisma.outboxEvent.findFirst({
        where: {
          aggregateType: 'CONSULTATION',
          aggregateId: consultation.id,
          eventType: 'CONSULTATION_COMPLETED',
        },
      });
      expect(outbox).not.toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // Phase 3: Payment Orchestration & Trusted Server Pricing
  // --------------------------------------------------------------------------
  describe('Phase 3: Server-Side Trusted Payments & Webhooks', () => {
    let paymentConsultation: any;
    let paymentOrder: any;

    beforeAll(async () => {
      const paySlot = await prisma.availabilitySlot.create({
        data: {
          doctorId: doctorProfile.id,
          startTime: new Date(Date.now() + 110000000),
          endTime: new Date(Date.now() + 110000000 + 1800000),
          status: SlotStatus.BOOKED,
        },
      });

      paymentConsultation = await prisma.consultation.create({
        data: {
          slotId: paySlot.id,
          doctorId: doctorProfile.id,
          patientId: patientProfile.id,
          status: ConsultationStatus.BOOKED,
        },
      });
    });

    it('should create payment order with server-side fee derivation (ignores client-supplied amounts)', async () => {
      const res = await request(app)
        .post('/api/v1/payments/create-order')
        .set('Authorization', patientToken)
        .send({
          consultationId: paymentConsultation.id,
          // Intentionally trying to supply an arbitrary price - should be ignored
          amount: 1,
        });

      expect(res.status).toBe(201);
      expect(Number(res.body.data.amount)).toBe(750); // Matches doctorProfile.consultationFee
      expect(res.body.data.status).toBe(PaymentStatus.PENDING);
      expect(res.body.data.providerOrderId).toBeDefined();

      paymentOrder = res.body.data;
    });

    it('should process simulated payment capture and transition consultation to CONFIRMED', async () => {
      const res = await request(app)
        .post('/api/v1/payments/mock-capture')
        .set('Authorization', patientToken)
        .send({
          orderId: paymentOrder.providerOrderId,
        });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe(PaymentStatus.CAPTURED);

      // Verify consultation updated to CONFIRMED
      const updatedConsultation = await prisma.consultation.findUnique({
        where: { id: paymentConsultation.id },
      });
      expect(updatedConsultation?.status).toBe(ConsultationStatus.CONFIRMED);
    });

    it('should idempotently handle webhook event deduplication', async () => {
      const eventId = `webhook_test_${Date.now()}`;
      const payload = {
        event_id: eventId,
        event: 'payment.captured',
        orderId: paymentOrder.providerOrderId,
        paymentId: 'pay_rzp_mock_123',
      };

      // First webhook delivery
      const firstWebhook = await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(firstWebhook.status).toBe(200);
      expect(firstWebhook.body.duplicate).toBe(false);

      // Second webhook replay
      const duplicateWebhook = await request(app)
        .post('/api/v1/payments/webhook')
        .set('Content-Type', 'application/json')
        .send(payload);

      expect(duplicateWebhook.status).toBe(200);
      expect(duplicateWebhook.body.duplicate).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 4: Transactional Outbox Background Worker
  // --------------------------------------------------------------------------
  describe('Phase 4: Transactional Outbox Background Worker', () => {
    it('should process and publish pending outbox events using batch claiming', async () => {
      // Check count of pending outbox events
      const pendingBefore = await prisma.outboxEvent.count({
        where: { status: OutboxStatus.PENDING },
      });
      expect(pendingBefore).toBeGreaterThan(0);

      // Execute a worker batch run
      const processedCount = await outboxWorker.processBatch(20);
      expect(processedCount).toBeGreaterThan(0);

      // Verify claimed records became PUBLISHED
      const publishedCount = await prisma.outboxEvent.count({
        where: { status: OutboxStatus.PUBLISHED },
      });
      expect(publishedCount).toBeGreaterThanOrEqual(processedCount);
    });
  });

  // --------------------------------------------------------------------------
  // Phase 5: Operational Analytics & Audit Logs
  // --------------------------------------------------------------------------
  describe('Phase 5: Administrative Analytics & Audit Integrity', () => {
    it('should return aggregated platform metrics for administrators', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.consultations).toBeDefined();
      expect(res.body.data.consultations.total).toBeGreaterThan(0);
      expect(res.body.data.consultations.byStatus).toBeDefined();
      expect(typeof res.body.data.consultations.cancellationRatePercent).toBe('number');
      expect(res.body.data.payments).toBeDefined();
      expect(res.body.data.doctors).toBeDefined();
    });

    it('should block non-admin users from accessing analytics', async () => {
      const res = await request(app)
        .get('/api/v1/admin/analytics/overview')
        .set('Authorization', patientToken);

      expect(res.status).toBe(403);
    });

    it('should return paginated audit logs for administrators', async () => {
      const res = await request(app)
        .get('/api/v1/admin/audit-logs?limit=5')
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.total).toBeGreaterThan(0);
    });
  });
});
