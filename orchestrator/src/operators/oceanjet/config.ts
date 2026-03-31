/**
 * Bookaway city name → OceanJet PRIME station code.
 * Keys are lowercase for case-insensitive lookup.
 */
export const STATION_CODES: Record<string, string> = {
  // Real city names from Bookaway API (confirmed from live data)
  'bohol': 'TAG',
  'tagbilaran city, bohol island': 'TAG',
  'cebu': 'CEB',
  'dumaguete': 'DUM',
  'siquijor': 'SIQ',
  'maasin city, leyte': 'MAA',
  'surigao': 'SUR',
  'surigao city, mindanao island': 'SUR',
  // Reference sheet names (for completeness)
  'tagbilaran': 'TAG',
  'bohol / tagbilaran': 'TAG',
  'bacolod': 'BAC',
  'batangas': 'BAT',
  'calapan': 'CAL',
  'camotes': 'CAM',
  'estancia': 'EST',
  'getafe': 'GET',
  'jetafe': 'GET',
  'bohol / jetafe (getafe)': 'GET',
  'bohol / jetafe': 'GET',
  'iligan': 'ILI',
  'iloilo': 'ILO',
  'larena': 'SIQ',
  'larena, siquijor': 'SIQ',
  'ormoc': 'ORM',
  'ormoc, leyte': 'ORM',
  'plaridel': 'PLA',
  'tubigon': 'TUB',
  'maasin': 'MAA',
  'palompon': 'PAL',
  'palompon, leyte': 'PAL',
};

/**
 * Bookaway vehicle/line class → OceanJet PRIME accommodation code.
 * Keys are lowercase for case-insensitive lookup.
 */
export const ACCOMMODATION_CODES: Record<string, string> = {
  // Real values from Bookaway API (product.lineClass)
  'tourist': 'TC',
  'business': 'BC',
  'open air': 'OA',
  // Reference sheet names (for completeness)
  'tourist class': 'TC',
  'business class': 'BC',
  'open-air': 'OA',
};

/**
 * Connecting routes: origin+destination pairs that require two legs via a hub.
 * Key format: "ORIGIN_CODE-DESTINATION_CODE"
 */
export interface ConnectingRouteLeg {
  origin: string;
  destination: string;
}

export interface ConnectingRoute {
  hub: string;
  leg1: ConnectingRouteLeg;
  leg2: ConnectingRouteLeg;
}

export const CONNECTING_ROUTES: Record<string, ConnectingRoute> = {
  'CEB-SIQ': {
    hub: 'TAG',
    leg1: { origin: 'CEB', destination: 'TAG' },
    leg2: { origin: 'TAG', destination: 'SIQ' },
  },
  'SIQ-CEB': {
    hub: 'TAG',
    leg1: { origin: 'SIQ', destination: 'TAG' },
    leg2: { origin: 'TAG', destination: 'CEB' },
  },
  'CEB-DUM': {
    hub: 'TAG',
    leg1: { origin: 'CEB', destination: 'TAG' },
    leg2: { origin: 'TAG', destination: 'DUM' },
  },
  'DUM-CEB': {
    hub: 'TAG',
    leg1: { origin: 'DUM', destination: 'TAG' },
    leg2: { origin: 'TAG', destination: 'CEB' },
  },
  'CEB-SUR': {
    hub: 'MAA',
    leg1: { origin: 'CEB', destination: 'MAA' },
    leg2: { origin: 'MAA', destination: 'SUR' },
  },
  'SUR-CEB': {
    hub: 'MAA',
    leg1: { origin: 'SUR', destination: 'MAA' },
    leg2: { origin: 'MAA', destination: 'CEB' },
  },
};

/**
 * Look up a station code from a Bookaway city name.
 */
export function resolveStationCode(cityName: string): string | undefined {
  return STATION_CODES[cityName.toLowerCase().trim()];
}

/**
 * Look up an accommodation code from a Bookaway vehicle/line class.
 */
export function resolveAccommodationCode(className: string): string | undefined {
  return ACCOMMODATION_CODES[className.toLowerCase().trim()];
}

/**
 * Check if a route is a connecting route and return its definition.
 */
export function findConnectingRoute(
  originCode: string,
  destinationCode: string
): ConnectingRoute | undefined {
  return CONNECTING_ROUTES[`${originCode}-${destinationCode}`];
}
