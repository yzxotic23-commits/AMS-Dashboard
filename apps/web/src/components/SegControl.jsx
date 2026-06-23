export default function SegControl({ value, onChange, options, size = 'md', variant = 'default' }) {
  const pad = size === 'sm' ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-[13px]';

  if (variant === 'separated') {
    return (
      <div className="inline-flex flex-wrap gap-2">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              className={`${pad} rounded-pill border font-medium transition-all shadow-card ${
                active
                  ? 'border-ams-accent bg-ams-accent font-semibold text-white'
                  : 'border-ams-line bg-ams-surface text-ams-muted hover:border-ams-accent/35 hover:text-ams-ink'
              }`}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <div className="inline-flex overflow-hidden rounded-pill border border-ams-line bg-ams-surface shadow-card">
      {options.map((opt, i) => {
        const active = value === opt.value;
        const activeClass = variant === 'notion'
          ? 'bg-ams-surface-muted font-semibold text-ams-ink'
          : 'bg-ams-accent font-semibold text-white';

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`${pad} font-medium transition-colors ${
              active ? activeClass : 'text-ams-muted hover:bg-ams-surface-muted'
            } ${i < options.length - 1 ? 'border-r border-ams-line' : ''}`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
