import { Construction } from 'lucide-react';
import PageHead from '../components/PageHead';

export default function PlaceholderPage({ title, phase, description }) {
  return (
    <div>
      <PageHead
        title={title}
        description={description || `Coming in ${phase}. API endpoints are available in the Phase 1 backend.`}
      />
      <div className="card flex flex-col items-center justify-center border-dashed py-20 text-center">
        <Construction size={32} className="mb-4 text-ams-faint" />
        <p className="text-sm font-semibold text-ams-muted">Coming in {phase}</p>
      </div>
    </div>
  );
}
