import { NextResponse } from 'next/server';

// Tipos de resposta de erro
export interface ApiError {
  message: string;
  code?: string;
  status: number;
}

// Handler para erros nas rotas de API
export function handleApiError(error: unknown): NextResponse {
  console.error('API Error:', error);
  
  // Erros já formatados
  if (error && typeof error === 'object' && 'status' in error && typeof error.status === 'number') {
    const apiError = error as ApiError;
    return NextResponse.json(
      { error: apiError.message, code: apiError.code },
      { status: apiError.status }
    );
  }
  
  // Erro genérico
  return NextResponse.json(
    { error: 'Internal server error', code: 'INTERNAL_ERROR' },
    { status: 500 }
  );
}

// Validação de tipos para requisições de API
export function validateRequest<T>(
  request: Request,
  schema: {
    validate: (data: unknown) => { value: T; error?: Error };
  }
): Promise<T> {
  return request.json()
    .then((data) => {
      const { value, error } = schema.validate(data);
      if (error) {
        throw {
          message: `Validation error: ${error.message}`,
          code: 'VALIDATION_ERROR',
          status: 400,
        };
      }
      return value;
    })
    .catch((error) => {
      if (error.status === 400) {
        throw error;
      }
      throw {
        message: 'Invalid request body',
        code: 'INVALID_REQUEST',
        status: 400,
      };
    });
} 