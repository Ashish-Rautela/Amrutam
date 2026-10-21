import bcrypt from 'bcryptjs';
import { PrismaClient, Role, VerificationStatus, SlotStatus, ConsultationMode } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Amrutam telemedicine database for evaluator demonstration...');

  const passwordHash = await bcrypt.hash('Password123!', 10);

  // 1. Seed Administrator
  const admin = await prisma.user.upsert({
    where: { email: 'admin@amrutam.co.in' },
    update: {},
    create: {
      email: 'admin@amrutam.co.in',
      phone: '+919999999999',
      passwordHash,
      role: Role.ADMIN,
    },
  });
  console.log(`[Seed] Administrator ready: ${admin.email} (Password: Password123!)`);

  // 2. Seed Verified Doctor
  const doctorUser = await prisma.user.upsert({
    where: { email: 'doctor@amrutam.co.in' },
    update: {},
    create: {
      email: 'doctor@amrutam.co.in',
      phone: '+918888888888',
      passwordHash,
      role: Role.DOCTOR,
    },
  });

  const doctorProfile = await prisma.doctorProfile.upsert({
    where: { userId: doctorUser.id },
    update: {
      verificationStatus: VerificationStatus.VERIFIED,
    },
    create: {
      userId: doctorUser.id,
      fullName: 'Dr. Ananya Sharma',
      licenseNumber: 'AYUSH-DL-2024-8888',
      specializations: ['Ayurvedic Medicine', 'Panchakarma', 'Kayachikitsa'],
      qualifications: ['BAMS', 'MD (Ayurveda)'],
      experienceYears: 12,
      consultationFee: 750,
      supportedModes: [ConsultationMode.VIDEO, ConsultationMode.AUDIO],
      languages: ['English', 'Hindi', 'Sanskrit'],
      bio: 'Senior Ayurvedic physician with 12+ years of experience in holistic constitutional healing.',
      verificationStatus: VerificationStatus.VERIFIED,
      verifiedAt: new Date(),
      verifiedBy: admin.id,
    },
  });
  console.log(`[Seed] Verified Doctor ready: ${doctorProfile.fullName} (${doctorUser.email})`);

  // 3. Seed Patient
  const patientUser = await prisma.user.upsert({
    where: { email: 'patient@amrutam.co.in' },
    update: {},
    create: {
      email: 'patient@amrutam.co.in',
      phone: '+917777777777',
      passwordHash,
      role: Role.PATIENT,
    },
  });

  const patientProfile = await prisma.patientProfile.upsert({
    where: { userId: patientUser.id },
    update: {},
    create: {
      userId: patientUser.id,
      fullName: 'Rahul Verma',
      gender: 'MALE',
      dateOfBirth: new Date('1992-06-15'),
      bloodGroup: 'B+',
    },
  });
  console.log(`[Seed] Patient ready: ${patientProfile.fullName} (${patientUser.email})`);

  // 4. Seed Doctor Availability Slots for Tomorrow
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setMinutes(0, 0, 0);

  const slotTimes = [10, 11, 14, 15]; // 10 AM, 11 AM, 2 PM, 3 PM
  for (const hour of slotTimes) {
    const startTime = new Date(tomorrow);
    startTime.setHours(hour);
    const endTime = new Date(startTime);
    endTime.setMinutes(30);

    const existingSlot = await prisma.availabilitySlot.findFirst({
      where: {
        doctorId: doctorProfile.id,
        startTime,
        endTime,
      },
    });

    if (!existingSlot) {
      await prisma.availabilitySlot.create({
        data: {
          doctorId: doctorProfile.id,
          startTime,
          endTime,
          status: SlotStatus.AVAILABLE,
        },
      });
      console.log(`[Seed] Created availability slot for ${startTime.toISOString()}`);
    }
  }

  console.log('Seeding completed successfully!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
