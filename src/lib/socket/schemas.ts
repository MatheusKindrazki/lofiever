import { z } from 'zod';

// Chat message payload schema with validation
// Note: trim() is applied BEFORE validation to ensure empty strings after trim are rejected
export const ChatMessagePayloadSchema = z.object({
  content: z
    .string()
    .transform((val) => val.trim())
    .pipe(
      z.string()
        .min(1, 'Message cannot be empty')
        .max(2000, 'Message too long (max 2000 characters)')
    ),
  type: z.enum(['user', 'system', 'ai']).default('user'),
  isPrivate: z.boolean().optional().default(false),
  locale: z.enum(['pt', 'en']).optional(),
  clientMessageId: z
    .string()
    .max(100, 'Client message ID too long')
    .optional(),
});

export type ValidatedChatMessagePayload = z.infer<typeof ChatMessagePayloadSchema>;

// Track ID schema for votes
export const TrackIdSchema = z
  .string()
  .min(1, 'Track ID cannot be empty')
  .max(100, 'Track ID too long');

// User ID schema
export const UserIdSchema = z
  .string()
  .min(1, 'User ID cannot be empty')
  .max(100, 'User ID too long');

// Username schema
export const UsernameSchema = z
  .string()
  .min(1, 'Username cannot be empty')
  .max(50, 'Username too long (max 50 characters)')
  .regex(/^[a-zA-Z0-9_\-\s]+$/, 'Username contains invalid characters');

// Locale schema
export const LocaleSchema = z.enum(['pt', 'en']);

// Socket auth schema
export const SocketAuthSchema = z.object({
  userId: z.string().optional(),
  username: z.string().optional(),
  locale: z.enum(['pt', 'en']).optional(),
});

export type ValidatedSocketAuth = z.infer<typeof SocketAuthSchema>;

// Helper function to safely validate with error handling
export function safeValidate<T>(
  schema: z.ZodSchema<T>,
  data: unknown
): { success: true; data: T } | { success: false; error: string } {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  // Format error message
  const errorMessage = result.error.issues
    .map((issue) => issue.message)
    .join(', ');

  return { success: false, error: errorMessage };
}
