import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { Role, VerificationStatus, ConsultationMode } from '@prisma/client';
import { app } from '../../src/app.js';
import { prisma } from '../../src/infrastructure/database/prisma.js';
import { config } from '../../src/config/index.js';

describe('Milestone 3 — Doctor Profiles & Admin Verification (Integration Tests)', () => {
  const runId = Date.now();

  let adminUser: any;
  let adminToken: string;

  let patientUser: any;
  let patientToken: string;

  let doctorApplicant: any;
  let doctorApplicantToken: string;
  let createdDoctorProfileId: string;

  beforeAll(async () => {
    // 1. Create Admin User
    adminUser = await prisma.user.create({
      data: {
        email: `admin_${runId}@example.com`,
        phone: `+9191${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy_hash',
        role: Role.ADMIN,
      },
    });
    adminToken = `Bearer ${jwt.sign(
      { sub: adminUser.id, email: adminUser.email, role: Role.ADMIN },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // 2. Create Regular Patient User
    patientUser = await prisma.user.create({
      data: {
        email: `patient_${runId}@example.com`,
        phone: `+9192${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy_hash',
        role: Role.PATIENT,
      },
    });
    patientToken = `Bearer ${jwt.sign(
      { sub: patientUser.id, email: patientUser.email, role: Role.PATIENT },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;

    // 3. Create Doctor Applicant User (starts as PATIENT)
    doctorApplicant = await prisma.user.create({
      data: {
        email: `doc_applicant_${runId}@example.com`,
        phone: `+9193${Math.floor(10000000 + Math.random() * 90000000)}`,
        passwordHash: 'dummy_hash',
        role: Role.PATIENT,
      },
    });
    doctorApplicantToken = `Bearer ${jwt.sign(
      { sub: doctorApplicant.id, email: doctorApplicant.email, role: Role.PATIENT },
      config.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', issuer: config.JWT_ISSUER, audience: config.JWT_AUDIENCE, expiresIn: '1h' }
    )}`;
  });

  afterAll(async () => {
    // Clean up created resources
    const userIds = [adminUser?.id, patientUser?.id, doctorApplicant?.id].filter(Boolean);
    await prisma.auditLog.deleteMany({ where: { actorId: { in: userIds } } });
    await prisma.doctorProfile.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  describe('1. Doctor Profile Submission & Validation', () => {
    const validDoctorData = {
      fullName: 'Dr. Ayush Sharma',
      licenseNumber: `MCI-${runId}-123`,
      specializations: ['Ayurveda', 'Panchakarma'],
      qualifications: ['BAMS', 'MD (Ayurveda)'],
      experienceYears: 8,
      consultationFee: 500,
      supportedModes: [ConsultationMode.VIDEO, ConsultationMode.CHAT],
      languages: ['English', 'Hindi', 'Sanskrit'],
      bio: 'Experienced Ayurvedic practitioner specializing in holistic chronic care.',
    };

    it('should reject unauthenticated profile submission', async () => {
      const res = await request(app)
        .post('/api/v1/doctors/profile')
        .send(validDoctorData);

      expect(res.status).toBe(401);
    });

    it('should reject invalid profile data (invalid license format, negative fee)', async () => {
      const res = await request(app)
        .post('/api/v1/doctors/profile')
        .set('Authorization', doctorApplicantToken)
        .send({
          ...validDoctorData,
          licenseNumber: 'Bad@License#Invalid',
          consultationFee: -100,
          experienceYears: -5,
        });

      expect(res.status).toBe(400);
      expect(res.body.title).toBe('BAD_REQUEST');
    });

    it('should successfully submit a doctor profile in PENDING status without changing User.role', async () => {
      const res = await request(app)
        .post('/api/v1/doctors/profile')
        .set('Authorization', doctorApplicantToken)
        .send(validDoctorData);

      expect(res.status).toBe(201);
      expect(res.body.status).toBe('success');
      expect(res.body.data.verificationStatus).toBe(VerificationStatus.PENDING);
      expect(res.body.data.licenseNumber).toBe(validDoctorData.licenseNumber.toUpperCase());
      createdDoctorProfileId = res.body.data.id;

      // Verify database state: User.role MUST still be PATIENT until admin approves
      const user = await prisma.user.findUnique({ where: { id: doctorApplicant.id } });
      expect(user!.role).toBe(Role.PATIENT);

      // Verify audit log recorded
      const audit = await prisma.auditLog.findFirst({
        where: {
          actorId: doctorApplicant.id,
          action: 'DOCTOR_PROFILE_SUBMITTED',
          resourceId: createdDoctorProfileId,
        },
      });
      expect(audit).not.toBeNull();
    });

    it('should prevent duplicate doctor profile submission by the same user', async () => {
      const res = await request(app)
        .post('/api/v1/doctors/profile')
        .set('Authorization', doctorApplicantToken)
        .send(validDoctorData);

      expect(res.status).toBe(409);
      expect(res.body.detail).toContain('already exists for this account');
    });

    it('should prevent duplicate medical license registration across users', async () => {
      const res = await request(app)
        .post('/api/v1/doctors/profile')
        .set('Authorization', patientToken)
        .send({
          ...validDoctorData,
          fullName: 'Dr. Impostor',
          licenseNumber: validDoctorData.licenseNumber, // Same license
        });

      expect(res.status).toBe(409);
      expect(res.body.detail).toContain('already registered');
    });
  });

  describe('2. Doctor Profile Retrieval & Updates', () => {
    it('should allow applicant to retrieve their own profile', async () => {
      const res = await request(app)
        .get('/api/v1/doctors/profile/me')
        .set('Authorization', doctorApplicantToken);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(createdDoctorProfileId);
      expect(res.body.data.verificationStatus).toBe(VerificationStatus.PENDING);
    });

    it('should allow doctor to update permitted profile fields (qualifications, fee, bio)', async () => {
      const res = await request(app)
        .patch('/api/v1/doctors/profile/me')
        .set('Authorization', doctorApplicantToken)
        .send({
          consultationFee: 750,
          bio: 'Updated bio with additional specialty details.',
        });

      expect(res.status).toBe(200);
      expect(Number(res.body.data.consultationFee)).toBe(750);
      expect(res.body.data.bio).toBe('Updated bio with additional specialty details.');
    });

    it('should ignore/prevent mass assignment of protected fields (licenseNumber, verificationStatus, role)', async () => {
      const res = await request(app)
        .patch('/api/v1/doctors/profile/me')
        .set('Authorization', doctorApplicantToken)
        .send({
          licenseNumber: 'NEW-FORGED-LICENSE',
          verificationStatus: VerificationStatus.VERIFIED,
          role: Role.ADMIN,
        });

      expect(res.status).toBe(200);
      // License and status must remain unaltered in the database
      const profile = await prisma.doctorProfile.findUnique({
        where: { id: createdDoctorProfileId },
      });
      expect(profile!.verificationStatus).toBe(VerificationStatus.PENDING);
      expect(profile!.licenseNumber).not.toBe('NEW-FORGED-LICENSE');
    });
  });

  describe('3. Public Directory Visibility for Unapproved Doctors', () => {
    it('should NOT include unapproved (PENDING) doctors in public directory', async () => {
      const res = await request(app).get('/api/v1/doctors');

      expect(res.status).toBe(200);
      const ids = res.body.data.map((d: any) => d.id);
      expect(ids).not.toContain(createdDoctorProfileId);
    });

    it('should return 404 Not Found when attempting to publicly fetch an unapproved doctor by ID', async () => {
      const res = await request(app).get(`/api/v1/doctors/${createdDoctorProfileId}`);

      expect(res.status).toBe(404);
      expect(res.body.detail).toContain('not currently verified');
    });
  });

  describe('4. Administrative Verification Workflow', () => {
    it('should forbid non-admins from accessing pending doctor list', async () => {
      const res = await request(app)
        .get('/api/v1/admin/doctors/pending')
        .set('Authorization', patientToken);

      expect(res.status).toBe(403);
    });

    it('should allow admin to list pending doctor applications', async () => {
      const res = await request(app)
        .get('/api/v1/admin/doctors/pending')
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeInstanceOf(Array);
      const pendingIds = res.body.data.map((d: any) => d.id);
      expect(pendingIds).toContain(createdDoctorProfileId);
    });

    it('should forbid non-admins from approving doctor profiles', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/doctors/${createdDoctorProfileId}/approve`)
        .set('Authorization', patientToken);

      expect(res.status).toBe(403);
    });

    it('should prevent an admin from approving their own doctor profile', async () => {
      // Create a doctor profile for the admin
      const adminDoctorProfile = await prisma.doctorProfile.create({
        data: {
          userId: adminUser.id,
          fullName: 'Dr. Admin Self',
          licenseNumber: `ADMIN-LIC-${runId}`,
          consultationFee: 1000,
          verificationStatus: VerificationStatus.PENDING,
        },
      });

      const res = await request(app)
        .post(`/api/v1/admin/doctors/${adminDoctorProfile.id}/approve`)
        .set('Authorization', adminToken);

      expect(res.status).toBe(403);
      expect(res.body.detail).toContain('cannot approve their own doctor profile');

      // Clean up
      await prisma.doctorProfile.delete({ where: { id: adminDoctorProfile.id } });
    });

    it('should allow admin to approve a doctor, upgrading User.role to DOCTOR and setting VERIFIED status', async () => {
      const res = await request(app)
        .post(`/api/v1/admin/doctors/${createdDoctorProfileId}/approve`)
        .set('Authorization', adminToken);

      expect(res.status).toBe(200);
      expect(res.body.data.verificationStatus).toBe(VerificationStatus.VERIFIED);
      expect(res.body.data.verifiedBy).toBe(adminUser.id);
      expect(res.body.data.verifiedAt).not.toBeNull();

      // Assert PostgreSQL database state: User.role is upgraded to DOCTOR
      const user = await prisma.user.findUnique({ where: { id: doctorApplicant.id } });
      expect(user!.role).toBe(Role.DOCTOR);

      // Verify audit log
      const audit = await prisma.auditLog.findFirst({
        where: {
          actorId: adminUser.id,
          action: 'DOCTOR_PROFILE_APPROVED',
          resourceId: createdDoctorProfileId,
        },
      });
      expect(audit).not.toBeNull();
    });

    it('should now display approved doctor in public directory and single doctor view', async () => {
      // Directory
      const dirRes = await request(app).get('/api/v1/doctors');
      expect(dirRes.status).toBe(200);
      const ids = dirRes.body.data.map((d: any) => d.id);
      expect(ids).toContain(createdDoctorProfileId);

      // Filter by specialization
      const filterRes = await request(app).get('/api/v1/doctors?specialization=Panchakarma');
      expect(filterRes.status).toBe(200);
      const filteredIds = filterRes.body.data.map((d: any) => d.id);
      expect(filteredIds).toContain(createdDoctorProfileId);

      // Single Doctor Profile View
      const singleRes = await request(app).get(`/api/v1/doctors/${createdDoctorProfileId}`);
      expect(singleRes.status).toBe(200);
      expect(singleRes.body.data.fullName).toBe('Dr. Ayush Sharma');
      // Ensure private fields (like verifiedBy, internal IDs) are omitted in public view
      expect(singleRes.body.data).not.toHaveProperty('verifiedBy');
    });

    it('should allow admin to reject a doctor profile with mandatory rejection reason', async () => {
      // Create another applicant user to reject
      const rejectedUser = await prisma.user.create({
        data: {
          email: `rejected_${runId}@example.com`,
          phone: `+9194${Math.floor(10000000 + Math.random() * 90000000)}`,
          passwordHash: 'dummy',
          role: Role.PATIENT,
        },
      });

      const rejectedProfile = await prisma.doctorProfile.create({
        data: {
          userId: rejectedUser.id,
          fullName: 'Dr. Fraudulent Credentials',
          licenseNumber: `FAKE-LIC-${runId}`,
          consultationFee: 200,
          verificationStatus: VerificationStatus.PENDING,
        },
      });

      // Reject without reason -> 400
      const badReq = await request(app)
        .post(`/api/v1/admin/doctors/${rejectedProfile.id}/reject`)
        .set('Authorization', adminToken)
        .send({});
      expect(badReq.status).toBe(400);

      // Reject with reason
      const res = await request(app)
        .post(`/api/v1/admin/doctors/${rejectedProfile.id}/reject`)
        .set('Authorization', adminToken)
        .send({ reason: 'Medical registration certificate could not be verified with state council.' });

      expect(res.status).toBe(200);
      expect(res.body.data.verificationStatus).toBe(VerificationStatus.REJECTED);
      expect(res.body.data.rejectionReason).toBe(
        'Medical registration certificate could not be verified with state council.'
      );

      // User role remains PATIENT
      const user = await prisma.user.findUnique({ where: { id: rejectedUser.id } });
      expect(user!.role).toBe(Role.PATIENT);

      // Clean up
      await prisma.auditLog.deleteMany({ where: { actorId: adminUser.id, resourceId: rejectedProfile.id } });
      await prisma.doctorProfile.delete({ where: { id: rejectedProfile.id } });
      await prisma.user.delete({ where: { id: rejectedUser.id } });
    });
  });
});
