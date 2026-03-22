// --- Auth ---

export interface LoginRequest {
  username: string;
  password: string;
}

export interface LoginResponse {
  access_token: string;
  token_type: string;
  smoochUserId: string;
  smoochAppId: string;
}

// --- Booking List ---

export interface BookingListResponse {
  data: BookingSummary[];
}

export interface BookingSummary {
  _id: string;
  reference: string;
  status: string;
  inProgressBy: string | null;
  items: BookingItemSummary[];
}

export interface BookingItemSummary {
  reference: string;
  productType: string;
  product: {
    lineClass?: string;
  };
}

export interface LocationInfo {
  city: {
    name: string;
  };
  address: string;
}

// --- Single Booking Detail ---

export interface BookingDetail {
  _id: string;
  reference: string;
  status: string;
  inProgressBy: string | null;
  contact: {
    email: string;
    phone: string;
  };
  misc: BookingMisc;
  items: BookingItem[];
}

export interface BookingMisc {
  route: string;
  departureDate: string;
  departureTime: string;
  returnDepartureDate?: string;
  returnDepartureTime?: string;
  passengers: string;
}

export interface BookingItem {
  reference: string;
  product: {
    _id: string;
    lineClass?: string;
  };
  trip: {
    fromId: LocationInfo;
    toId: LocationInfo;
  };
  passengers: Passenger[];
}

export interface Passenger {
  firstName: string;
  lastName: string;
  _id: string;
  extraInfos?: ExtraInfo[];
  contact?: {
    phone: string;
    email: string;
  };
}

export interface ExtraInfo {
  definition: string;
  value: string;
}

// --- Approve Booking ---

export interface ApprovalRequest {
  extras: unknown[];
  pickups: { time: number; location: null }[];
  dropOffs: (null)[];
  voucherAttachments: unknown[];
  approvalInputs: {
    bookingCode: string;
    departureTrip: {
      seatsNumber: string[];
      ticketsQrCode: unknown[];
    };
    returnTrip: {
      seatsNumber: string[];
      ticketsQrCode: unknown[];
    };
  };
}

// --- Update In Progress ---

export interface UpdateInProgressRequest {
  inProgressBy: string | null;
}
