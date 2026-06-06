import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { PhaseSettingsModal } from './PhaseSettingsModal';

function IconMenu() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}
function IconX() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2.5} viewBox="0 0 24 24">
      <path strokeLinecap="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

const LINKS = [
  { to: '/grupos',        label: 'Grupos',          emoji: '🏟️' },
  { to: '/chaveamento',   label: 'Chaveamento',      emoji: '⚡' },
  { to: '/meus-palpites', label: 'Meus Palpites',    emoji: '🎯' },
  { to: '/classificacao', label: 'Classificação',    emoji: '🏆' },
  { to: '/regras',        label: 'Regras',           emoji: '📋' },
];

export function Navbar() {
  const { profile, logout } = useAuthStore();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [phaseModal, setPhaseModal] = useState(false);
  const isAdmin = profile?.isAdmin ?? false;
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fecha o dropdown ao clicar fora
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [dropdownOpen]);

  const handleLogout = async () => {
    setOpen(false);
    setDropdownOpen(false);
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <>
      <nav
        className="sticky top-0 z-50"
        style={{ background: '#0A0A0A', borderBottom: '1px solid #1A1A1A' }}
      >
        <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">

          {/* Logo */}
          <Link to="/" className="flex items-center gap-2 shrink-0">
            <span className="text-xl">⚽</span>
            <div className="flex flex-col leading-tight">
              <span
                className="font-black text-white text-sm uppercase"
                style={{ fontStyle: 'italic', letterSpacing: '0.04em' }}
              >
                Bolão da Copa
                <span className="text-copa-green ml-1">🏆</span>
              </span>
              <span className="text-[9px] text-copa-green font-bold tracking-[0.2em] uppercase hidden sm:block">
                golfleet · 2026
              </span>
            </div>
          </Link>

          {/* Desktop links (md+) */}
          {profile && (
            <div className="hidden md:flex items-center gap-1 flex-1 justify-center">
              {LINKS.map(l => {
                const active = pathname === l.to;
                return (
                  <Link
                    key={l.to}
                    to={l.to}
                    className="px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-all"
                    style={{
                      color: active ? '#22C55E' : '#6B7280',
                      background: active ? '#22C55E15' : 'transparent',
                      borderBottom: active ? '2px solid #22C55E' : '2px solid transparent',
                    }}
                  >
                    {l.label}
                  </Link>
                );
              })}
            </div>
          )}

          {/* Right side */}
          <div className="flex items-center gap-2 shrink-0">
            {profile && (
              <>
                {/* Username dropdown (desktop) */}
                <div className="relative hidden md:block" ref={dropdownRef}>
                  <button
                    onClick={() => setDropdownOpen(o => !o)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-semibold transition-all"
                    style={{
                      color: dropdownOpen ? '#22C55E' : '#6B7280',
                      border: '1px solid',
                      borderColor: dropdownOpen ? '#22C55E40' : '#1F1F1F',
                      background: dropdownOpen ? '#22C55E10' : 'transparent',
                    }}
                  >
                    {profile.isAdmin && <span className="text-copa-green text-xs">★</span>}
                    <span>{profile.username}</span>
                    <svg
                      className="w-3 h-3 transition-transform"
                      style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)', color: '#4B5563' }}
                      fill="currentColor" viewBox="0 0 16 16"
                    >
                      <path d="M8 10.5 L2 4.5 L14 4.5 Z" />
                    </svg>
                  </button>

                  {/* Dropdown panel */}
                  {dropdownOpen && (
                    <div
                      className="absolute right-0 mt-2 w-48 rounded-xl overflow-hidden z-50"
                      style={{ background: '#111111', border: '1px solid #1F1F1F', boxShadow: '0 8px 32px #00000080' }}
                    >
                      {isAdmin && (
                        <>
                          <button
                            onClick={() => { setDropdownOpen(false); setPhaseModal(true); }}
                            className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium transition-all text-left"
                            style={{ color: '#22C55E' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#22C55E10'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                          >
                            <span>⚙️</span>
                            <span>Fases</span>
                          </button>
                          <Link
                            to="/auditoria"
                            onClick={() => setDropdownOpen(false)}
                            className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium transition-all"
                            style={{ color: '#22C55E', borderTop: '1px solid #1F1F1F' }}
                            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#22C55E10'; }}
                            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                          >
                            <span>📋</span>
                            <span>Auditoria</span>
                          </Link>
                        </>
                      )}

                      <div style={{ borderTop: isAdmin ? '1px solid #1F1F1F' : 'none' }}>
                        <button
                          onClick={handleLogout}
                          className="w-full flex items-center gap-2.5 px-4 py-3 text-sm font-medium transition-all text-left"
                          style={{ color: '#EF4444' }}
                          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#EF444410'; }}
                          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        >
                          <span>🚪</span>
                          <span>Sair</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Hamburger (mobile) */}
                <button
                  onClick={() => setOpen(o => !o)}
                  className="md:hidden flex items-center justify-center w-9 h-9 rounded-lg transition-colors"
                  style={{ color: open ? '#22C55E' : '#9CA3AF', background: open ? '#22C55E15' : 'transparent', border: '1px solid #1F1F1F' }}
                  aria-label="Menu"
                >
                  {open ? <IconX /> : <IconMenu />}
                </button>
              </>
            )}

            {!profile && (
              <Link to="/login" className="btn-primary text-sm py-1.5 px-4">Entrar</Link>
            )}
          </div>
        </div>
      </nav>

      {/* Mobile drawer */}
      {open && profile && (
        <>
          {/* Overlay */}
          <div
            className="fixed inset-0 z-40 md:hidden"
            style={{ background: '#00000080' }}
            onClick={() => setOpen(false)}
          />
          {/* Menu panel */}
          <div
            className="fixed top-14 left-0 right-0 z-50 md:hidden"
            style={{ background: '#0D0D0D', borderBottom: '1px solid #1A1A1A' }}
          >
            {/* User info */}
            <div
              className="flex items-center gap-3 px-4 py-3"
              style={{ borderBottom: '1px solid #1A1A1A' }}
            >
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
                style={{ background: '#22C55E20', color: '#22C55E', border: '1px solid #22C55E40' }}
              >
                {profile.username.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="text-sm font-medium text-white flex items-center gap-1">
                  {profile.isAdmin && <span className="text-copa-green text-xs">★</span>}
                  {profile.username}
                </div>
                <div className="text-xs" style={{ color: '#4B5563' }}>Golfleet · 2026</div>
              </div>
            </div>

            {/* Nav links */}
            <div className="py-2">
              {LINKS.map(l => {
                const active = pathname === l.to;
                return (
                  <Link
                    key={l.to}
                    to={l.to}
                    onClick={() => setOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 text-sm font-medium transition-all"
                    style={{
                      color: active ? '#22C55E' : '#9CA3AF',
                      background: active ? '#22C55E10' : 'transparent',
                      borderLeft: active ? '3px solid #22C55E' : '3px solid transparent',
                    }}
                  >
                    <span>{l.emoji}</span>
                    <span>{l.label}</span>
                    {active && <span className="ml-auto text-copa-green text-xs">●</span>}
                  </Link>
                );
              })}
            </div>

            {/* ⚙ Admin tools — mobile */}
            {isAdmin && (
              <div className="px-4 pb-1 space-y-2" style={{ borderTop: '1px solid #1A1A1A' }}>
                <button
                  onClick={() => { setOpen(false); setPhaseModal(true); }}
                  className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg text-sm font-medium transition-all mt-2"
                  style={{ color: '#22C55E', background: '#22C55E10', border: '1px solid #22C55E30' }}
                >
                  <span>⚙️</span>
                  <span>Configurar Fases</span>
                </button>
                <Link
                  to="/auditoria"
                  onClick={() => setOpen(false)}
                  className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg text-sm font-medium transition-all"
                  style={{ color: '#22C55E', background: '#22C55E10', border: '1px solid #22C55E30' }}
                >
                  <span>📋</span>
                  <span>Auditoria</span>
                </Link>
              </div>
            )}

            {/* Sair */}
            <div className="px-4 py-3" style={{ borderTop: '1px solid #1A1A1A' }}>
              <button
                onClick={handleLogout}
                className="w-full flex items-center gap-3 py-2.5 px-3 rounded-lg text-sm font-medium transition-all"
                style={{ color: '#EF4444', background: '#EF444410', border: '1px solid #EF444430' }}
              >
                <span>🚪</span>
                <span>Sair da conta</span>
              </button>
            </div>
          </div>
        </>
      )}

      {/* Modal de configuração de fases (admin) */}
      {phaseModal && <PhaseSettingsModal onClose={() => setPhaseModal(false)} />}
    </>
  );
}
