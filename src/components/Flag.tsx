interface Props {
  code: string;
  name?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  className?: string;
}

// flagcdn.com only accepts these exact widths: 20, 40, 80, 160, 320...
const CDN_PX: Record<string, number> = { sm: 40, md: 40, lg: 80, xl: 80 };
const DISPLAY_PX: Record<string, number> = { sm: 24, md: 32, lg: 48, xl: 64 };

export function Flag({ code, name = '', size = 'md', className = '' }: Props) {
  const cdnW = CDN_PX[size];
  const displayW = DISPLAY_PX[size];
  const displayH = Math.round(displayW * 0.67);
  const src = `https://flagcdn.com/w${cdnW}/${code.toLowerCase()}.png`;
  const src2x = `https://flagcdn.com/w${cdnW * 2}/${code.toLowerCase()}.png`;

  return (
    <img
      src={src}
      srcSet={`${src} 1x, ${src2x} 2x`}
      alt={name}
      title={name}
      width={displayW}
      height={displayH}
      className={`rounded-sm object-cover shadow-sm inline-block ${className}`}
      loading="lazy"
    />
  );
}
