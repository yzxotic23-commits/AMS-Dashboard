import { useSite } from '../context/SiteContext';
import { useAuth } from '../context/AuthContext';
import { SITE_OPTIONS, SITES } from '../lib/sites';
import { siteOptionsForProfile } from '../lib/operator-scope';

export default function SiteSwitcher() {
  const { profile } = useAuth();
  const { site, setSite } = useSite();
  const options = siteOptionsForProfile(profile);

  if (options.length === 1) {
    const id = options[0];
    return (
      <div className="site-switcher site-switcher--locked" role="status" aria-label="Assigned site">
        <span className="site-tab site-tab-active cursor-default">
          <span className="hidden sm:inline">{SITES[id].name}</span>
          <span className="sm:hidden">{SITES[id].short}</span>
        </span>
      </div>
    );
  }

  return (
    <div className="site-switcher" role="tablist" aria-label="Site filter">
      {SITE_OPTIONS.filter((id) => options.includes(id)).map((id) => {

        const active = site === id;

        const label = SITES[id].name;

        const short = SITES[id].short;



        return (

          <button

            key={id}

            type="button"

            role="tab"

            aria-selected={active}

            onClick={() => setSite(id)}

            className={active ? 'site-tab site-tab-active' : 'site-tab'}

          >

            <span className="hidden sm:inline">{label}</span>

            <span className="sm:hidden">{short}</span>

          </button>

        );

      })}

    </div>

  );

}

