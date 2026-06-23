import { useSite } from '../context/SiteContext';

import { SITE_OPTIONS, SITES } from '../lib/sites';



export default function SiteSwitcher() {

  const { site, setSite } = useSite();



  return (

    <div className="site-switcher" role="tablist" aria-label="Site filter">

      {SITE_OPTIONS.map((id) => {

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

