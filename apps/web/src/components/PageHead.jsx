import { PageHeaderPills } from './PageHeaderPills';

export default function PageHead({ description, actions, descActions }) {
  const hasBody = Boolean(description || descActions);
  return (
    <>
      <PageHeaderPills>{actions}</PageHeaderPills>
      {hasBody ? (
        <header className="page-head mb-4">
          {descActions ? (
            <div className="page-head-desc-row">
              {description && <p className="page-head-desc">{description}</p>}
              <div className="page-head-desc-actions">{descActions}</div>
            </div>
          ) : description ? (
            <p className="page-head-desc">{description}</p>
          ) : null}
        </header>
      ) : null}
    </>
  );
}
