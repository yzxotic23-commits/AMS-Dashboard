export default function PageHead({ title, description, actions, descActions }) {
  return (
    <header className="page-head mb-6">
      <div className="page-head-row">
        <h1 className="page-head-title">{title}</h1>
        {actions && <div className="page-head-actions">{actions}</div>}
      </div>
      {descActions ? (
        <div className="page-head-desc-row">
          {description && <p className="page-head-desc">{description}</p>}
          <div className="page-head-desc-actions">{descActions}</div>
        </div>
      ) : description ? (
        <p className="page-head-desc">{description}</p>
      ) : null}
    </header>
  );
}
