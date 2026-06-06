import { useEffect } from 'react';
import { useAuthStore } from '../store/authStore';

function GoogleIcon() {
  return (
    <svg className="w-5 h-5 shrink-0" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

export function Login() {
  const { loginWithGoogle, loading, error, clearError } = useAuthStore();

  // Limpa erro anterior ao montar.
  // `clearError` é uma action do Zustand — ref estável entre renders, então
  // incluir nas deps não causa re-execução; só deixa o eslint feliz.
  useEffect(() => { clearError(); }, [clearError]);

  const handleGoogle = async () => {
    clearError();
    await loginWithGoogle();
  };

  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center px-4 relative overflow-hidden"
      style={{ background: '#070707' }}
    >
      {/* Glow roxo no topo */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background: 'radial-gradient(ellipse 70% 45% at 50% 0%, #8300ff1A 0%, transparent 65%)',
        }}
      />

      <div className="relative w-full max-w-sm flex flex-col items-center">
        {/* Hero */}
        <div className="text-center mb-10">

          {/* Logo Golfleet com backdrop semi-transparente */}
          <div className="flex justify-center mb-6">
            <div
              className="rounded-2xl p-4 flex items-center justify-center"
              style={{
                background: 'rgba(131, 0, 255, 0.08)',
                border: '1px solid rgba(131, 0, 255, 0.15)',
                backdropFilter: 'blur(12px)',
              }}
            >
              <img
                src="https://azmlwmrfskqfgdfsccxf.supabase.co/storage/v1/object/public/images/G-degrade.png"
                alt="Golfleet"
                className="h-16 w-auto object-contain"
                style={{ filter: 'drop-shadow(0 0 16px rgba(131, 0, 255, 0.5))' }}
              />
            </div>
          </div>

          <h1
            className="text-6xl font-black uppercase text-white leading-none tracking-tight mb-1"
            style={{ fontStyle: 'italic', textShadow: '0 0 50px #8300ff2A' }}
          >
            BOLÃO DA
          </h1>
          <h1
            className="text-6xl font-black uppercase leading-none tracking-tight"
            style={{ fontStyle: 'italic', color: '#8300ff', textShadow: '0 0 40px #8300ff66' }}
          >
            COPA 🏆
          </h1>
          <p className="text-gray-600 text-sm mt-4">
            Faça login com sua conta Golfleet
          </p>
        </div>

        {/* Card */}
        <div
          className="w-full rounded-2xl p-6"
          style={{ background: '#111111', border: '1px solid #1F1F1F' }}
        >
          {/* Erro de domínio ou OAuth */}
          {error && (
            <div
              className="mb-4 rounded-xl px-4 py-3 text-sm text-center font-medium"
              style={{ background: '#EF444415', border: '1px solid #EF444440', color: '#FCA5A5' }}
            >
              🔒 {error}
            </div>
          )}

          {/* Botão Google */}
          <button
            onClick={handleGoogle}
            disabled={loading}
            className="w-full flex items-center justify-center gap-3 font-bold py-3.5 px-4 rounded-xl transition-all text-white"
            style={{ background: '#8300ff' }}
            onMouseEnter={e => { if (!loading) { (e.currentTarget as HTMLElement).style.background = '#6600cc'; (e.currentTarget as HTMLElement).style.transform = 'translateY(-1px)'; (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 24px #8300ff44'; } }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#8300ff'; (e.currentTarget as HTMLElement).style.transform = ''; (e.currentTarget as HTMLElement).style.boxShadow = ''; }}
          >
            {loading ? (
              <span className="animate-pulse">Redirecionando...</span>
            ) : (
              <>
                <GoogleIcon />
                <span>Entrar com Google</span>
              </>
            )}
          </button>

          {/* Aviso de domínio */}
          <p className="text-center text-xs mt-4" style={{ color: '#374151' }}>
            Exclusivo para colaboradores{' '}
            <span style={{ color: '#8300ff' }}>@golfleet.com.br</span>
          </p>
        </div>

        {/* Linha decorativa */}
        <div className="mt-8 flex items-center gap-3 w-full opacity-30">
          <div className="flex-1 h-px" style={{ background: '#8300ff' }} />
          <span className="text-xs text-copa-green font-bold tracking-widest uppercase">Golfleet</span>
          <div className="flex-1 h-px" style={{ background: '#8300ff' }} />
        </div>
      </div>
    </div>
  );
}
