import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export function Register() {
  const { register, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [username, setUsername] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    await register(email, password, username);
    if (!useAuthStore.getState().error) navigate('/grupos');
  };

  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="card w-full max-w-md">
        <h1 className="text-2xl font-bold text-copa-gold text-center mb-1">⚽ Bolão Copa 2026</h1>
        <p className="text-gray-400 text-center text-sm mb-6">Crie sua conta e entre no bolão</p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Nome de usuário</label>
            <input type="text" className="input" placeholder="Ex: joao123" value={username} onChange={e => setUsername(e.target.value)} required minLength={3} />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Email</label>
            <input type="email" className="input" placeholder="seu@email.com" value={email} onChange={e => setEmail(e.target.value)} required />
          </div>
          <div>
            <label className="block text-sm text-gray-400 mb-1">Senha</label>
            <input type="password" className="input" placeholder="Mínimo 6 caracteres" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} />
          </div>
          {error && <p className="text-red-400 text-sm bg-red-900/30 border border-red-800 rounded-lg p-2">{error}</p>}
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? 'Cadastrando...' : 'Criar Conta'}
          </button>
        </form>

        <p className="text-center text-sm text-gray-500 mt-4">
          Já tem conta?{' '}
          <Link to="/login" className="text-copa-green hover:underline">Entrar</Link>
        </p>
      </div>
    </div>
  );
}
