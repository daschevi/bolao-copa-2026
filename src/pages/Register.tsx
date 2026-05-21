// Página de cadastro removida — login exclusivo via Google corporativo
// Redirecionamento feito no App.tsx
import { Navigate } from 'react-router-dom';
export function Register() {
  return <Navigate to="/login" replace />;
}
