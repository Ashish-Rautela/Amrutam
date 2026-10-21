import { z } from 'zod';

export const prescriptionItemSchema = z.object({
  medicineName: z.string().min(1, 'Medicine name is required'),
  dosage: z.string().min(1, 'Dosage is required (e.g., 500mg)'),
  frequency: z.string().min(1, 'Frequency is required (e.g., 1-0-1 after food)'),
  durationDays: z.coerce.number().int().min(1, 'Duration must be at least 1 day').max(365),
  instructions: z.string().max(500).optional(),
});

export const createPrescriptionSchema = z
  .object({
    params: z.object({
      id: z.string().uuid('Invalid consultation ID format'),
    }),
    body: z.object({
      diagnosis: z.string().min(3, 'Diagnosis must be at least 3 characters').max(2000),
      advice: z.string().max(4000).optional(),
      items: z.array(prescriptionItemSchema).min(1, 'At least one prescription item is required'),
      parentPrescriptionId: z.string().uuid().optional(),
      amendmentReason: z.string().min(5, 'Amendment reason must be at least 5 characters').max(1000).optional(),
    }),
  })
  .refine(
    (data) => {
      if (data.body.parentPrescriptionId && !data.body.amendmentReason) {
        return false;
      }
      return true;
    },
    {
      message: 'amendmentReason is required when amending a prior prescription (parentPrescriptionId provided)',
      path: ['body', 'amendmentReason'],
    }
  );

export type CreatePrescriptionInput = z.infer<typeof createPrescriptionSchema>['body'];

export const getPrescriptionSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid prescription ID format'),
  }),
});
