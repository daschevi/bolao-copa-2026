import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';

export function Navbar() {
  const { profile, logout } = useAuthStore();
  const { pathname } = useLocation();

  const links = [
    { to: '/grupos', label: 'Grupos' },
    { to: '/chaveamento', label: 'Chaveamento' },
    { to: '/meus-palpites', label: 'Meus Palpites' },
    { to: '/classificacao', label: 'Classificação' },
  ];

  return (
    <nav className="bg-copa-navy border-b border-slate-700 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 flex items-center justify-between h-14">
        <Link to="/" className="flex items-center gap-2 font-bold text-copa-gold text-lg">
          ⚽ Bolão Copa 2026
        </Link>

        {profile && (
          <div className="flex items-center gap-1 overflow-x-auto">
            {links.map(l => (
              <Link
                key={l.to}
                to={l.to}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium whitespace-nowrap transition-colors ${pathname === l.to ? 'bg-copa-green text-white' : 'text-gray-300 hover:text-white hover:bg-slate-700'}`}
              >
                {l.label}
              </Link>
            ))}
          </div>
        )}

        <div className="flex items-center gap-3 ml-4 shrink-0">
          {profile ? (
            <>
              <span className="text-sm text-gray-400 hidden sm:block">
                {profile.isAdmin && <span className="text-copa-gold mr-1">★</span>}
                {profile.username}
              </span>
              <button onClick={() => logout()} className="text-sm text-gray-400 hover:text-white transition-colors">
                Sair
              </button>
            </>
          ) : (
            <Link to="/login" className="btn-primary text-sm py-1 px-3">Entrar</Link>
          )}
        </div>
      </div>
    </nav>
  );
}
