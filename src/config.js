// -----------------------------------------------------------------------------
// Integration configuration: defaults (they mirror the `default` values of the
// manifest `config_schema`, see test/manifest.test.js) and normalization, so
// the rest of the code never deals with strings, blanks or `undefined`.
//
// Select values are strings in the manifest (stored by Gladys as typed); the
// normalized config holds numbers, in seconds.
// -----------------------------------------------------------------------------

export const LANGUAGES = ['en', 'fr', 'de', 'es'];

// Minutes between two reads of every host. Above one minute: the devices are
// published with should_poll: false and the container runs its own timer.
export const POLL_INTERVALS = ['1', '2', '5', '10', '15', '30'];

export const DEFAULT_CONFIG = {
  poll_interval: '5',
  standard_metrics: true,
  private_key: '',
  private_key_passphrase: '',
  language: 'fr',
};

const isFalse = (value) => value === false || value === 'false' || value === 0 || value === '0';

/**
 * @param {Record<string, unknown>} raw the configuration returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const interval = POLL_INTERVALS.includes(String(source.poll_interval))
    ? source.poll_interval
    : DEFAULT_CONFIG.poll_interval;
  return {
    pollInterval: Number(interval) * 60,
    standardMetrics: !isFalse(source.standard_metrics),
    privateKey: typeof source.private_key === 'string' ? source.private_key.trim() : '',
    passphrase:
      typeof source.private_key_passphrase === 'string' ? source.private_key_passphrase : '',
    language: LANGUAGES.includes(source.language) ? source.language : DEFAULT_CONFIG.language,
  };
}
