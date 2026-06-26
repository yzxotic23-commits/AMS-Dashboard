import PageHead from '../../components/PageHead';
import RmSupplySettingsPanel from '../../components/RmSupplySettingsPanel';
import { useSite } from '../../context/SiteContext';

export default function SettingsPage() {
  const { site } = useSite();

  return (
    <div>
      <PageHead
        title="RM Supply model"
        description="Configure formula inputs per site. Auto mode uses live AMS metrics; manual mode locks a fixed value. Outputs drive Register queue flags and supply targets."
      />
      <RmSupplySettingsPanel site={site} />
    </div>
  );
}
