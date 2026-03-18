# Bookaway Backoffice API Documentation (v2)

> **Updated:** March 2026. This version is based on verified responses from the live Bookaway API, correcting field paths and structures from the original documentation.

This documentation outlines the internal API endpoints used to authenticate, retrieve, and process bookings from the Bookaway backoffice.

## 1. Authentication

All requests to the Bookaway API require a Bearer Token. Use this endpoint to authenticate using backoffice credentials and retrieve your `access_token`.

### **Login**

* **Endpoint:** `POST https://www.bookaway.com/_api/users/auth/login`
* **Content-Type:** `application/json`

#### Request Body

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `username` | string | Yes | The email address of the backoffice user. |
| `password` | string | Yes | The user's password. |

> **Note:** The `recaptchaToken` parameter often seen in browser requests is optional for this API integration.

#### Example Request

```bash
curl -X POST 'https://www.bookaway.com/_api/users/auth/login' \
  -H 'content-type: application/json' \
  -H 'origin: https://admin.bookaway.com' \
  --data-raw '{
    "username": "your.email@bookaway.com",
    "password": "YOUR_PASSWORD_HERE"
  }'
```

#### Response

```json
{
    "access_token": "bWfgmCHjqdS6iWNWi901hwNReQJ0U6oFf0V3rhQNhs...",
    "token_type": "bearer",
    "smoochUserId": "61dac2a7458fbf7e53718a7b",
    "smoochAppId": "5d09e69ee3a5d9001286da39"
}
```

**Next Step:** Use the `access_token` in the `Authorization` header for all subsequent requests:
`Authorization: Bearer <access_token>`

---

## 2. Fetch Pending Bookings

Retrieves a list of bookings based on specific filters. The configuration below is optimized to fetch **pending** bookings for a specific supplier (e.g., OceanJet), sorted by the **earliest departure date**.

* **Endpoint:** `GET https://www.bookaway.com/_api/bookings/bookings`
* **Authentication:** Requires Bearer Token.

#### Query Parameters

| Parameter | Value | Description |
| --- | --- | --- |
| `supplier` | `5c6147b2967ae90001ca6702` | The unique ID of the supplier (e.g., OceanJet). |
| `status` | `pending` | Filters for bookings with a pending status. |
| `customerStatus` | `pending` | Filters for bookings where the customer status is pending. |
| `payment` | `paid;authorized` | Includes only bookings that are paid or authorized. |
| `sort` | `departureDate:1` | Sorts results by departure date (Ascending/Earliest first). |
| `limit` | `50` | The number of results to return per page. |
| `disableCount` | `true` | Performance optimization. |
| `domain` | `all` | Search scope. |
| `date` | `created` | Context for date filtering. |

#### Example Request

```bash
curl -G 'https://www.bookaway.com/_api/bookings/bookings' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'accept: application/json' \
  --data-urlencode 'supplier=5c6147b2967ae90001ca6702' \
  --data-urlencode 'status=pending' \
  --data-urlencode 'customerStatus=pending' \
  --data-urlencode 'payment=paid;authorized' \
  --data-urlencode 'sort=departureDate:1' \
  --data-urlencode 'limit=50' \
  --data-urlencode 'disableCount=true' \
  --data-urlencode 'domain=all' \
  --data-urlencode 'date=created'
```

#### Response Structure

Returns an object containing a `data` array. Each entry is a booking summary.

```json
{
  "data": [
    {
      "_id": "696f9eda176298545b70c5ab",
      "reference": "BW4638466",
      "cartReference": "CT4516275",
      "status": "pending",
      "customerStatus": "pending",
      "inProgressBy": "Jason Oceanjet",
      "items": [
        {
          "reference": "IT5645919",
          "productType": "line",
          "product": {
            "lineClass": "Open Air",
            "type": "ferry",
            "ecommerce": {
              "name": "Open Air Ferry by OceanJet"
            }
          }
        }
      ],
      "misc": {
        "route": "Cebu to Bohol",
        "passengers": "Jose Miguel Calvo Vilchez, Maria de los Angeles Montesdeoca Toribio",
        "passengersNumber": 2,
        "departureDate": "Fri, Mar 13th 2026",
        "departureTime": "15:20"
      },
      "contact": {
        "firstName": "Jose Miguel",
        "lastName": "Calvo Vilchez",
        "phone": "+34660272118",
        "email": "joosemi.1993@gmail.com"
      }
    }
  ]
}
```

#### Key Response Fields

| Field | Type | Description |
| --- | --- | --- |
| `data[]._id` | string | **Booking ID** (MongoDB ObjectId). Required for all subsequent API calls. |
| `data[].reference` | string | Human-readable booking reference (e.g., `BW4638466`). |
| `data[].status` | string | Current status (e.g., `pending`). |
| `data[].inProgressBy` | string / null | Email of the agent currently working on the booking, or `null` if unclaimed. |
| `data[].items[]` | array | Array of booking items (typically 1 item per booking). |
| `data[].items[].reference` | string | Item reference (e.g., `IT5645919`). **Note:** Items do not have an `_id` field. |
| `data[].items[].product.lineClass` | string | Accommodation class: `"Tourist"`, `"Business"`, or `"Open Air"`. |
| `data[].misc.route` | string | Human-readable route (e.g., `"Cebu to Bohol"`). |
| `data[].misc.departureDate` | string | Formatted departure date (e.g., `"Fri, Mar 13th 2026"`). |
| `data[].misc.departureTime` | string | Departure time in 24h format (e.g., `"15:20"`). |

---

## 3. Fetch Single Booking Details

Retrieves the full details of a specific booking using its unique ID. This is necessary to get the exact passenger details, itinerary, and item reference before confirming.

* **Endpoint:** `GET https://www.bookaway.com/_api/bookings/bookings/{booking_id}`
* **Method:** `GET`
* **Authentication:** Requires Bearer Token.

#### Example Request

```bash
curl 'https://www.bookaway.com/_api/bookings/bookings/696f9eda176298545b70c5ab' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'accept: application/json' \
  -H 'origin: https://admin.bookaway.com'
```

### Data Extraction Guide

Use the following paths to extract specific information from the response JSON. All paths are verified against the live API.

#### **A. Route & Location**

| Data Point | JSON Path | Example Value |
| --- | --- | --- |
| **Route Name** | `misc.route` | `"Cebu to Bohol"` |
| **Origin City** | `items[0].trip.fromId.city.name` | `"Cebu"` |
| **Destination City** | `items[0].trip.toId.city.name` | `"Bohol"` |
| **Origin Address** | `items[0].trip.fromId.address` | `"Cebu Pier 1, Cebu City, Cebu, Philippines"` |
| **Destination Address** | `items[0].trip.toId.address` | `"Tagbilaran City Port Terminal, Tagbilaran City, Bohol, Central Visayas, Philippines"` |

> **Important:** The city names returned by the API do not always match the reference sheet names. Known variations:
>
> | API City Name | Expected Name | PRIME Code |
> | --- | --- | --- |
> | `Cebu` | Cebu | CEB |
> | `Bohol` | Bohol | TAG |
> | `Tagbilaran City, Bohol Island` | Bohol / Tagbilaran | TAG |
> | `Siquijor` | Siquijor | SIQ |
> | `Dumaguete` | Dumaguete | DUM |
> | `Maasin City, Leyte` | Maasin | MAA |
> | `Surigao` | Surigao | SUR |

#### **B. Schedule**

| Data Point | JSON Path | Example Value | Notes |
| --- | --- | --- | --- |
| **Departure Date** | `misc.departureDate` | `"Fri, Mar 13th 2026"` | Formatted string with ordinal suffix. |
| **Departure Time** | `misc.departureTime` | `"15:20"` | 24-hour local time. |
| **Return Date** | `misc.returnDepartureDate` | `"Sun, Apr 19th 2026"` | Empty string `""` if one-way. |
| **Return Time** | `misc.returnDepartureTime` | `"12:00"` | Empty string `""` if one-way. |

> **Note:** For one-way bookings, `returnDepartureDate` and `returnDepartureTime` are empty strings (`""`), not `null` or absent.

#### **C. Accommodation Class**

| Data Point | JSON Path | Example Value |
| --- | --- | --- |
| **Line Class** | `items[0].product.lineClass` | `"Open Air"` |

The API returns the class name without "Class" suffix:

| API Value | PRIME Code |
| --- | --- |
| `"Tourist"` | TC |
| `"Business"` | BC |
| `"Open Air"` | OA |

#### **D. Passenger Details**

| Data Point | JSON Path | Example Value |
| --- | --- | --- |
| **Passenger Names** | `misc.passengers` | `"Jose Miguel Calvo Vilchez, Maria de los Angeles Montesdeoca Toribio"` |
| **Passenger Count** | `misc.passengersNumber` | `2` |
| **Detailed List** | `items[0].passengers` | *(Array of objects — see below)* |

Each passenger object:

```json
{
  "firstName": "Jose Miguel",
  "lastName": "Calvo Vilchez",
  "_id": "696f9eda1762987e8470c5ad",
  "extraInfos": [
    {
      "_id": "696f9eda1762983c6870c5ae",
      "definition": "58f47db102e97f000888b001",
      "value": "Male"
    },
    {
      "_id": "696f9eda176298a5fb70c5af",
      "definition": "58f47da902e97f000888b000",
      "value": "32"
    },
    {
      "_id": "696f9eda17629819fb70c5b0",
      "definition": "619a4c6c4dbac3332cdfab10",
      "value": "Australia"
    }
  ],
  "contact": {
    "phone": "+34660272118",
    "email": "joosemi.1993@gmail.com"
  },
  "baggage": []
}
```

> **Important:** Age and gender are **not** top-level fields on the passenger object. They are stored inside the `extraInfos` array, identified by definition IDs:
>
> | Definition ID | Label | Example Value |
> | --- | --- | --- |
> | `58f47da902e97f000888b000` | Age | `"32"` |
> | `58f47db102e97f000888b001` | Gender | `"Male"` or `"Female"` |
> | `619a4c6c4dbac3332cdfab10` | Nationality | `"Australia"` |
>
> The human-readable labels can be found in `items[0].transferData.passengerExtraInfoDefinitions`:
> ```json
> [
>   { "_id": "58f47da902e97f000888b000", "label": "Age" },
>   { "_id": "58f47db102e97f000888b001", "label": "Gender" }
> ]
> ```

#### **E. Customer Contact**

| Data Point | JSON Path | Example Value |
| --- | --- | --- |
| **Email** | `contact.email` | `"joosemi.1993@gmail.com"` |
| **Phone** | `contact.phone` | `"+34660272118"` |
| **First Name** | `contact.firstName` | `"Jose Miguel"` |
| **Last Name** | `contact.lastName` | `"Calvo Vilchez"` |

#### **F. Booking Assignment**

| Data Point | JSON Path | Example Value | Notes |
| --- | --- | --- | --- |
| **In Progress By** | `inProgressBy` | `"Jason Oceanjet"` or not present | If set, another agent is working on this booking. If missing or `null`, the booking is available. |

#### **G. Item Identifiers**

| Data Point | JSON Path | Example Value | Notes |
| --- | --- | --- | --- |
| **Item Reference** | `items[0].reference` | `"IT5645919"` | The unique identifier for this booking item. |
| **Product ID** | `items[0].product._id` | `"5c614ac8750acbb1e77fe8e0"` | The product definition ID (shared across bookings of the same route/class). |

> **Note:** Items do **not** have a top-level `_id` field. The item-specific identifier is `items[0].reference`.

---

## 4. Confirm / Approve Booking

This endpoint finalizes the booking. It sends the supplier's confirmation details (Booking Code and Seat Numbers) to the system.

* **Endpoint:** `POST https://www.bookaway.com/_api/bookings/v2/bookings/{booking_id}/approve`
* **Method:** `POST`
* **Authentication:** Requires Bearer Token.

#### Request Schema

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `booking_id` | string | **Yes (URL)** | The main Booking ID (`_id` from Step 2 or 3). |
| `extras` | array | Yes | Always `[]`. |
| `pickups` | array | Yes | Always `[{"time": 0, "location": null}]`. |
| `dropOffs` | array | Yes | Always `[null]`. |
| `voucherAttachments` | array | Yes | Always `[]`. |
| `approvalInputs` | object | **Yes** | Container for confirmation data. |
| `approvalInputs.bookingCode` | string | **Yes** | All ticket numbers, space-separated (e.g., `"1111111 2222222"`). |
| `approvalInputs.departureTrip` | object | **Yes** | Outbound trip ticket details. |
| `approvalInputs.departureTrip.seatsNumber` | array | **Yes** | Array of ticket number strings, one per departure ticket. |
| `approvalInputs.departureTrip.ticketsQrCode` | array | Yes | Always `[]`. |
| `approvalInputs.returnTrip` | object | **Yes** | Return trip ticket details. |
| `approvalInputs.returnTrip.seatsNumber` | array | **Yes** | Array of ticket number strings for the return leg. Empty `[]` if one-way. |
| `approvalInputs.returnTrip.ticketsQrCode` | array | Yes | Always `[]`. |

#### Example Request: One-Way, 2 Passengers

```bash
curl -X POST 'https://www.bookaway.com/_api/bookings/v2/bookings/696f9eda176298545b70c5ab/approve' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'origin: https://admin.bookaway.com' \
  --data-raw '{
    "extras": [],
    "pickups": [{"time": 0, "location": null}],
    "dropOffs": [null],
    "voucherAttachments": [],
    "approvalInputs": {
        "bookingCode": "1111111 2222222",
        "departureTrip": {
            "seatsNumber": [
                "1111111",
                "2222222"
            ],
            "ticketsQrCode": []
        },
        "returnTrip": {
            "seatsNumber": [],
            "ticketsQrCode": []
        }
    }
  }'
```

#### Example Request: Round-Trip, 1 Passenger

```bash
curl -X POST 'https://www.bookaway.com/_api/bookings/v2/bookings/69a01c0a30f5e5a34c7216e6/approve' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'origin: https://admin.bookaway.com' \
  --data-raw '{
    "extras": [],
    "pickups": [{"time": 0, "location": null}],
    "dropOffs": [null],
    "voucherAttachments": [],
    "approvalInputs": {
        "bookingCode": "1111111 2222222",
        "departureTrip": {
            "seatsNumber": ["1111111"],
            "ticketsQrCode": []
        },
        "returnTrip": {
            "seatsNumber": ["2222222"],
            "ticketsQrCode": []
        }
    }
  }'
```

#### Important Logic

1. **No `_id` field:** The `approvalInputs` object does **not** include an `_id` field. Confirmed via staging E2E test (March 2026) — including `_id` causes a 500 "Cast to ObjectId" error.
2. **Booking Code:** All ticket numbers concatenated with spaces.
3. **One-Way:** All ticket numbers go into `departureTrip.seatsNumber`. `returnTrip.seatsNumber` is `[]`.
4. **Round Trip:** Departure ticket numbers go into `departureTrip.seatsNumber`, return ticket numbers into `returnTrip.seatsNumber`.
5. **Multiple Passengers:** One ticket number per passenger per trip direction (e.g., 2 passengers one-way = 2 entries in `departureTrip.seatsNumber`).

---

## 5. Update "In Progress" Status

This endpoint allows an agent to claim a booking to prevent overlapping work by multiple agents. It can also be used to release the booking back into the queue.

* **Endpoint:** `PUT https://www.bookaway.com/_api/bookings/v2/bookings/{booking_id}/update-in-progress`
* **Method:** `PUT`
* **Authentication:** Requires Bearer Token.

#### Request Body

| Parameter | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `inProgressBy` | string / null | Yes | The email address of the agent working on the booking. Send `null` to release the booking. |

#### Example Request: Claim a Booking

```bash
curl -X PUT 'https://www.bookaway.com/_api/bookings/v2/bookings/696f9eda176298545b70c5ab/update-in-progress' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'origin: https://admin.bookaway.com' \
  --data-raw '{
    "inProgressBy": "your.email@bookaway.com"
  }'
```

#### Example Request: Release a Booking

```bash
curl -X PUT 'https://www.bookaway.com/_api/bookings/v2/bookings/696f9eda176298545b70c5ab/update-in-progress' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'origin: https://admin.bookaway.com' \
  --data-raw '{
    "inProgressBy": null
  }'
```

#### Response

A successful claim or release will return a success status.

```json
{
    "status": "success"
}
```

---

## Appendix: Key Differences from Original Documentation

| Topic | Original Doc | Actual API |
| --- | --- | --- |
| **Origin/Destination City** | `items[0].product.tripInfo.fromId.city.name` | `items[0].trip.fromId.city.name` |
| **Item ID** | `items[0]._id` | Items have no `_id`; `items[0].reference` exists but is **not** used in approval |
| **Approval `_id`** | `approvalInputs._id` = item reference | `approvalInputs` has **no `_id` field** — including it causes a 500 error |
| **Passenger Age** | `items[0].passengers[i].age` (direct field) | `items[0].passengers[i].extraInfos` with definition `58f47da902e97f000888b000` |
| **Passenger Gender** | `extraInfos` with `definition: "Gender"` | `extraInfos` with definition ID `58f47db102e97f000888b001` |
| **Nationality** | `items[0].passengers[i].residence.name.common` | `extraInfos` with definition ID `619a4c6c4dbac3332cdfab10` |
| **Accommodation Class** | `items[0].product.vehicle.class` = `"Tourist Class"` | `items[0].product.lineClass` = `"Tourist"` |
| **City Name: Bohol** | `"Bohol / Tagbilaran"` | `"Bohol"` or `"Tagbilaran City, Bohol Island"` |
| **City Name: Maasin** | `"Maasin"` | `"Maasin City, Leyte"` |
| **Return fields (one-way)** | Not present / undefined | Present but empty string `""` |
