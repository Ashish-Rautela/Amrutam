import { z } from 'zod';
import { SlotStatus } from '@prisma/client';

export const slotTimeRangeSchema = z
  .object({
    startTime: z
      .string()
      .datetime({ offset: true })
      .describe('ISO 8601 UTC or offset string for slot start time'),
    endTime: z
      .string()
      .datetime({ offset: true })
      .describe('ISO 8601 UTC or offset string for slot end time'),
  })
  .refine(
    (data) => new Date(data.endTime) > new Date(data.startTime),
    {
      message: 'Slot end time must be strictly after start time',
      path: ['endTime'],
    }
  );

export const createAvailabilitySlotsSchema = z.object({
  body: z
    .object({
      startTime: z.string().datetime({ offset: true }).optional(),
      endTime: z.string().datetime({ offset: true }).optional(),
      slots: z.array(slotTimeRangeSchema).min(1).max(50).optional(),
    })
    .refine(
      (data) => (data.startTime && data.endTime) || (data.slots && data.slots.length > 0),
      {
        message: 'Either provide startTime and endTime for a single slot, or an array of slots',
        path: ['slots'],
      }
    )
    .refine(
      (data) => {
        if (data.startTime && data.endTime) {
          return new Date(data.endTime) > new Date(data.startTime);
        }
        return true;
      },
      {
        message: 'Slot end time must be strictly after start time',
        path: ['endTime'],
      }
    ),
});

export const updateAvailabilitySlotSchema = z.object({
  body: z
    .object({
      startTime: z.string().datetime({ offset: true }).optional(),
      endTime: z.string().datetime({ offset: true }).optional(),
      status: z.nativeEnum(SlotStatus).optional(),
    })
    .refine(
      (data) => {
        if (data.startTime && data.endTime) {
          return new Date(data.endTime) > new Date(data.startTime);
        }
        return true;
      },
      {
        message: 'Slot end time must be strictly after start time',
        path: ['endTime'],
      }
    ),
});

export const queryAvailabilitySlotsSchema = z.object({
  query: z.object({
    startDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional(),
    endDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional(),
    status: z.nativeEnum(SlotStatus).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  }),
});

export const queryDoctorPublicSlotsSchema = z.object({
  params: z.object({
    doctorId: z.string().uuid('Doctor ID must be a valid UUID'),
  }),
  query: z.object({
    startDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional(),
    endDate: z
      .string()
      .datetime({ offset: true })
      .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/))
      .optional(),
  }),
});
