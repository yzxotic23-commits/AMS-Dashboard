function FieldRow({ label, left, right, highlightDiff = true }) {
  const diff = highlightDiff && left !== right;
  return (
    <div className="ipcmp-row">
      <span className="ipcmp-k">{label}</span>
      <span className={`ipcmp-v${diff ? ' diff' : ''}`}>{right || '—'}</span>
    </div>
  );
}

export default function IpCompare({ bind, shot }) {
  if (!bind || !shot) return null;

  const fields = [
    ['IP', bind.ip_address, shot.ip_address],
    ['Port', String(bind.port), String(shot.port)],
    ['User', bind.username, shot.username],
    ['Pass', bind.password, shot.password],
  ];

  return (
    <div className="ipcmp-grid">
      <div className="ipcmp-col">
        <div className="ipcmp-col-title">Bound</div>
        <div className="ipcmp-one ipcmp-one--flat">
          {fields.map(([label, val]) => (
            <div key={label} className="ipcmp-row">
              <span className="ipcmp-k">{label}</span>
              <span className="ipcmp-v">{val || '—'}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="ipcmp-col">
        <div className="ipcmp-col-title">Submitted</div>
        <div className="ipcmp-one ipcmp-one--flat">
          {fields.map(([label, , shotVal]) => {
            const bindVal = fields.find(([l]) => l === label)?.[1];
            const diff = bindVal !== shotVal;
            return (
              <div key={label} className="ipcmp-row">
                <span className="ipcmp-k">{label}</span>
                <span className={`ipcmp-v${diff ? ' diff' : ''}`}>{shotVal || '—'}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
