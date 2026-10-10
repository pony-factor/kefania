import { z } from 'zod';

export const draftSchema = z.object({ title: z.string().trim().min(1).max(256), body: z.string().trim().min(1).max(60000) });
export const outputSchema = { type: 'object', properties: { title: { type: 'string' }, body: { type: 'string' } },
  required: ['title', 'body'], additionalProperties: false };
