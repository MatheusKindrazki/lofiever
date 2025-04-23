import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Middleware aplicado apenas a rotas de API
export const config = {
  matcher: '/api/:path*',
};

export function middleware(request: NextRequest): NextResponse {
  // Iniciar timer para medir a duração da requisição
  const startTime = Date.now();
  
  // Log da requisição
  console.log(`[API] ${request.method} ${request.nextUrl.pathname}`);
  
  // Continuar com a requisição
  const response = NextResponse.next();
  
  // Adicionar headers de resposta
  response.headers.set('X-API-Version', '1.0.0');
  response.headers.set('X-Response-Time', `${Date.now() - startTime}ms`);
  
  // Adicionar CORS headers para desenvolvimento local
  if (process.env.NODE_ENV === 'development') {
    response.headers.set('Access-Control-Allow-Origin', '*');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  
  return response;
} 