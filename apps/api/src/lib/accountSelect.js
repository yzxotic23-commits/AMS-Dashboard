/**
 * Disambiguated account embeds for PostgREST.
 * accounts↔devices/sims/ips each have two FK paths (e.g. device_id + current_account_id).
 * Use explicit FK constraint names so Supabase knows which join to follow.
 */
const DEVICE = 'devices!accounts_device_id_fkey';
const SIM = 'sims!accounts_sim_id_fkey';
const IP = 'ips!accounts_ip_id_fkey';

export const ACCOUNT_SELECT =
  `*, ${DEVICE}(device_name), ${SIM}(phone_number, carrier), ${IP}(ip_address, port, username, password, country)`;

export const ACCOUNT_SELECT_WITH_SIM_LOCATION = ACCOUNT_SELECT;

export const ACCOUNT_SELECT_FULL =
  `*, ${DEVICE}(*), ${SIM}(*), ${IP}(*)`;

export const ACCOUNT_SELECT_TICKET =
  `*, ${DEVICE}(device_name), ${SIM}(phone_number), ${IP}(ip_address, port, username, password, country)`;

export const ACCOUNT_SELECT_IP_GATE =
  `*, ${DEVICE}(device_name), ${IP}(ip_address, port, username, password)`;

export const ACCOUNT_SELECT_BAN =
  `*, ${DEVICE}(device_name), ${IP}(ip_address), ${SIM}(phone_number, carrier)`;
