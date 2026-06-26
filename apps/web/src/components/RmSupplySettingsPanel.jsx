import { useEffect, useMemo, useState } from 'react';
import { RotateCcw, Save } from 'lucide-react';
import { SITES } from '../lib/sites';
import {
  RM_FIELDS,
  defaultRmSupplySettings,
  normalizeRmSupplySettings,
  previewSiteOutput,
} from '../lib/rm-supply-config';
import { useRmSupplySettings, useRmSupplySettingsMutations } from '../hooks/useRmSupplySettings';
import Toast from './Toast';

function SourceToggle({ value, onChange, disabled }) {
  return (
    <div className="rm-source-toggle">
      {[
        { key: 'live', label: 'Auto' },
        { key: 'manual', label: 'Manual' },
      ].map(({ key, label }) => (
        <button
          key={key}
          type="button"
          className={`rm-source-toggle-btn${value === key ? ' rm-source-toggle-btn--on' : ''}`}
          disabled={disabled}
          onClick={() => onChange(key)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function OutputCard({ label, value, sub }) {
  return (
    <div className="rm-output-card">
      <div className="rm-output-label">{label}</div>
      <div className="rm-output-value">
        {value}
        {sub ? <span className="rm-output-sub">{sub}</span> : null}
      </div>
    </div>
  );
}

function SiteEditor({ siteKey, siteModel, config, onChange, disabled }) {
  const preview = useMemo(
    () => previewSiteOutput(siteModel, config),
    [siteModel, config],
  );

  function patchConfig(patch) {
    onChange({
      ...config,
      ...patch,
      sources: { ...config.sources, ...(patch.sources || {}) },
      manual: { ...config.manual, ...(patch.manual || {}) },
    });
  }

  return (
    <div className="rm-settings-site">
      <div className="rm-settings-grid">
        <div className="card rm-settings-form">
          <div className="rm-settings-form-head">
            <h4 className="text-sm font-semibold text-ams-ink">Formula inputs</h4>
            <p className="text-[11px] text-ams-muted">
              Auto pulls live metrics from AMS. Manual uses your fixed value.
            </p>
          </div>
          <div className="rm-field-grid">
            {RM_FIELDS.map((field) => {
              const source = field.live ? (config.sources[field.key] || 'live') : 'manual';
              const liveVal = siteModel?.inputs?.live?.[field.key];
              const manualVal = config.manual[field.key] ?? '';
              const isAuto = source === 'live';

              return (
                <div key={field.key} className="rm-field-tile">
                  <div className="rm-field-tile-head">
                    <span className="rm-field-label">
                      {field.label}
                      <span className="rm-field-symbol">{field.symbol}</span>
                    </span>
                  </div>
                  <div className="rm-field-tile-row">
                    {field.live && (
                      <SourceToggle
                        value={source}
                        disabled={disabled}
                        onChange={(next) => patchConfig({
                          sources: { [field.key]: next },
                        })}
                      />
                    )}
                    <div className="rm-field-input-wrap">
                      <input
                        type="number"
                        className="input rm-field-input"
                        value={isAuto && field.live ? (liveVal ?? '') : manualVal}
                        disabled={disabled || (field.live && isAuto)}
                        step={field.unit === '%' ? '0.1' : '1'}
                        min="0"
                        title={field.hint}
                        onChange={(e) => patchConfig({
                          sources: field.live ? { [field.key]: 'manual' } : undefined,
                          manual: { [field.key]: Number(e.target.value) },
                        })}
                      />
                      {field.unit && (
                        <span className="rm-field-unit">{field.unit}</span>
                      )}
                    </div>
                  </div>
                  <p className="rm-field-foot">
                    {field.live && isAuto && liveVal != null
                      ? `Using AMS live: ${liveVal}${field.unit === '%' ? '%' : field.unit ? ` ${field.unit}` : ''}`
                      : field.live
                        ? 'Manual value — fixed until you switch back to Auto'
                        : field.hint}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

        <div className="card rm-settings-preview">
          <div className="rm-settings-form-head">
            <h4 className="text-sm font-semibold text-ams-ink">Calculated output</h4>
            <p className="text-[11px] text-ams-muted">
              Preview from {siteModel?.inputs?.active ?? 0} in-use accounts
            </p>
          </div>
          {!preview ? (
            <p className="text-sm text-ams-muted">No live data yet for this site.</p>
          ) : (
            <>
              <div className="rm-output-grid">
                <OutputCard label="Daily registration" value={preview.regDaily} sub="/ day" />
                <OutputCard label="Multiplier" value={`×${preview.mult}`} />
                <OutputCard label="Yield" value={`${preview.yield}%`} />
                <OutputCard label="Registering now" value={preview.registering} />
                <OutputCard label="Nurturing target" value={preview.warm} sub={`/ ${config.manual.W}d`} />
                <OutputCard label="Daily loss" value={preview.need} />
                <OutputCard label="Recovery backlog" value={preview.rec} />
                <OutputCard label="Devices needed" value={preview.devices} />
                <OutputCard label="Staff needed" value={preview.staff} />
              </div>
              <div className="rm-effective-row">
                <span className="text-[11px] font-medium text-ams-muted">Formula snapshot</span>
                <p className="text-[11px] leading-snug text-ams-faint">
                  Actual D / R / Wf / Fr / W values plugged into the calculation above.
                </p>
                <span className="font-mono text-[11px] text-ams-muted">
                  D {preview.effective.D}% · R {preview.effective.R}% · Wf {preview.effective.Wf}% · Fr {preview.effective.Fr}% · W {preview.effective.W}d
                </span>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RmSupplySettingsPanel({ site = 'all' }) {
  const { data, isLoading, isError, error } = useRmSupplySettings();
  const { save, reset } = useRmSupplySettingsMutations();
  const [draft, setDraft] = useState(defaultRmSupplySettings());
  const [activeSite, setActiveSite] = useState(site === 'all' ? 'my' : site);
  const [toast, setToast] = useState('');
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (data?.config) {
      setDraft(normalizeRmSupplySettings(data.config));
      setDirty(false);
    }
  }, [data?.config]);

  useEffect(() => {
    if (site !== 'all') setActiveSite(site);
  }, [site]);

  const siteTabs = site === 'all' ? ['my', 'pp'] : [site];
  const siteModel = site === 'all'
    ? data?.model?.sites?.[activeSite]
    : (data?.model?.sites?.[site] || data?.model);

  const busy = save.isPending || reset.isPending;

  async function handleSave() {
    try {
      await save.mutateAsync(draft);
      setDirty(false);
      setToast('RM supply settings saved');
    } catch (e) {
      setToast(e.message || 'Could not save settings');
    }
  }

  async function handleReset() {
    try {
      const result = await reset.mutateAsync();
      setDraft(normalizeRmSupplySettings(result.config));
      setDirty(false);
      setToast('Reset to defaults');
    } catch (e) {
      setToast(e.message || 'Could not reset settings');
    }
  }

  function updateSiteConfig(siteKey, nextConfig) {
    setDraft((prev) => ({ ...prev, [siteKey]: nextConfig }));
    setDirty(true);
  }

  if (isLoading) {
    return <p className="text-sm text-ams-muted">Loading RM supply settings…</p>;
  }

  if (isError) {
    const hint = String(error?.message || '').includes('404')
      ? 'Restart the AMS API server so the new /supply/rm-settings route is loaded. Also run Supabase migration 008_app_settings.sql for persistent storage.'
      : (error?.message || 'check admin access.');
    return (
      <div className="card px-5 py-4 text-sm text-ams-danger">
        Could not load settings — {hint}
      </div>
    );
  }

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          {site === 'all' ? (
            <div className="page-tab-bar rm-site-tabs">
              {siteTabs.map((sk) => (
                <button
                  key={sk}
                  type="button"
                  className={activeSite === sk ? 'page-tab page-tab-active' : 'page-tab'}
                  onClick={() => setActiveSite(sk)}
                >
                  {SITES[sk].name}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs text-ams-faint">{SITES[site].name}</p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm inline-flex items-center gap-1.5"
            disabled={busy}
            onClick={handleReset}
          >
            <RotateCcw size={14} />
            Reset defaults
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
            disabled={busy || !dirty}
            onClick={handleSave}
          >
            <Save size={14} />
            {save.isPending ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>

      <SiteEditor
        siteKey={activeSite}
        siteModel={siteModel}
        config={draft[activeSite]}
        disabled={busy}
        onChange={(next) => updateSiteConfig(activeSite, next)}
      />

      <Toast open={!!toast} message={toast} tone="success" onClose={() => setToast('')} />
    </div>
  );
}
