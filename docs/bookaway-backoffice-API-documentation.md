# Bookaway Backoffice API Documentation

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
curl -X POST '[https://www.bookaway.com/_api/users/auth/login](https://www.bookaway.com/_api/users/auth/login)' \
  -H 'content-type: application/json' \
  -H 'origin: [https://admin.bookaway.com](https://admin.bookaway.com)' \
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
curl -G '[https://www.bookaway.com/_api/bookings/bookings](https://www.bookaway.com/_api/bookings/bookings)' \
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

#### Key Response Fields

Returns an object containing a `data` array.

| Field | Description |
| --- | --- |
| `data._id` | **Booking ID**. Required for confirming/editing the booking. |
| `data.reference` | Human-readable booking reference (e.g., `BW4824920`). |
| `data.status` | Current status (e.g., `pending`). |
| `data.items[].route` | Simple route name (e.g., "Bohol to Cebu"). |
| `data.items[].tripInfo` | Contains detailed origin (`fromId`) and destination (`toId`) info. |

---

## 3. Fetch Single Booking Details

Retrieves the full details of a specific booking using its unique ID. This is necessary to get the exact passenger details and itinerary before confirming.

* **Endpoint:** `GET https://www.bookaway.com/_api/bookings/bookings/{booking_id}`
* **Method:** `GET`
* **Authentication:** Requires Bearer Token.

#### Example Request

```bash
curl '[https://www.bookaway.com/_api/bookings/bookings/699e0efb5b8168383a005f40](https://www.bookaway.com/_api/bookings/bookings/699e0efb5b8168383a005f40)' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'accept: application/json' \
  -H 'origin: [https://admin.bookaway.com](https://admin.bookaway.com)'

```

### Data Extraction Guide

Use the following paths to extract specific information from the response JSON.

#### **A. Route & Location**

| Data Point | JSON Path | Example Value |
| --- | --- | --- |
| **Route Name** | `misc.route` | `"Dumaguete to Siquijor"` |
| **Origin City** | `items[0].product.tripInfo.fromId.city.name` | `"Dumaguete"` |
| **Destination City** | `items[0].product.tripInfo.toId.city.name` | `"Siquijor"` |
| **Origin Address** | `items[0].product.tripInfo.fromId.address` | `"Dumaguete Port..."` |
| **Destination Address** | `items[0].product.tripInfo.toId.address` | `"Siquijor Pier..."` |

#### **B. Schedule**

| Data Point | JSON Path | Example Value | Notes |
| --- | --- | --- | --- |
| **Departure Date** | `misc.departureDate` | `"Wed, Apr 15th 2026"` | Formatted string. |
| **Departure Time** | `misc.departureTime` | `"13:00"` | Local time. |
| **Return Date** | `misc.returnDepartureDate` | `"Sun, Apr 19th 2026"` | **Optional.** Only present if Round Trip. |
| **Return Time** | `misc.returnDepartureTime` | `"12:00"` | **Optional.** Only present if Round Trip. |

#### **C. Passenger Details**

| Data Point | JSON Path | Example Value |
| --- | --- | --- |
| **Passenger Names** | `misc.passengers` | `"Zofia Swinarski, Flavio..."` |
| **Detailed List** | `items[0].passengers` | *(Array of objects)* |
| — **First Name** | `items[0].passengers[i].firstName` | `"Zofia"` |
| — **Last Name** | `items[0].passengers[i].lastName` | `"Swinarski"` |
| — **Age** | `items[0].passengers[i].age` | `"59"` |
| — **Gender** | `items[0].passengers[i].extraInfos` | Look for definition `Gender` |
| — **Nationality** | `items[0].passengers[i].residence.name.common` | `"Switzerland"` |

#### **D. Customer Contact**

| Data Point | JSON Path | Example Value |
| --- | --- | --- |
| **Email** | `contact.email` | `"zofia.swinarski@gmail.com"` |
| **Phone** | `contact.phone` | `"+41 78 826 82 98"` |

#### **E. Booking Assignment**

| Data Point | JSON Path | Example Value | Notes |
| --- | --- | --- | --- |
| **In Progress By** | `inProgressBy` | `"agent@bookaway.com"` or `null` | If it has a value, a Bookaway support/operations team member is currently handling the booking. If `null`, no one is currently working on it. |

---

## 4. Confirm / Approve Booking

This endpoint finalizes the booking. It sends the supplier's confirmation details (like Seat Numbers and Booking Codes) to the system.

* **Endpoint:** `POST https://www.bookaway.com/_api/bookings/v2/bookings/{booking_id}/approve`
* **Method:** `POST`
* **Authentication:** Requires Bearer Token.

#### Request Schema

The request structure accommodates single or multiple passengers.

| Parameter | Type | Required | Description |
| --- | --- | --- | --- |
| `booking_id` | string | **Yes (URL)** | The main Booking ID (from Step 2 or 3). |
| `approvalInputs` | object | **Yes** | Container for confirmation data. |
| `approvalInputs._id` | string | **Yes** | The **Item ID**. Get this from `items[0]._id` in the GET response. |
| `approvalInputs.bookingCode` | string | **Yes** | Supplier booking reference (e.g., "1111111"). |
| `approvalInputs.departureTrip` | object | **Yes** | Outbound trip details. |
| `...seatsNumber` | array | **Yes** | Array of strings. One seat per passenger. |
| `approvalInputs.returnTrip` | object | No | Return trip details (if round trip). |

#### Example Request (2 Passengers)

```bash
curl -X POST '[https://www.bookaway.com/_api/bookings/v2/bookings/69a01c0a30f5e5a34c7216e6/approve](https://www.bookaway.com/_api/bookings/v2/bookings/69a01c0a30f5e5a34c7216e6/approve)' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'origin: [https://admin.bookaway.com](https://admin.bookaway.com)' \
  --data-raw '{
    "extras": [],
    "pickups": [{"time": 0, "location": null}],
    "dropOffs": [null],
    "voucherAttachments": [],
    "approvalInputs": {
        "_id": "69546bcd69b5649f3c1905b7",
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

#### **Important Logic**

1. **Item ID (`_id`):** In the request body, you must include the `_id` of the specific item being approved. You retrieve this from the `items` array in the response from Step 3.
2. **Multiple Passengers:** Add strings to the `seatsNumber` array corresponding to the number of passengers (e.g., `["SeatA", "SeatB"]`).
3. **Round Trips:** If the booking is a round trip (see Step 3 Data Guide), you must populate `returnTrip.seatsNumber` as well.

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

Set the `inProgressBy` field to the agent's email address to lock the booking.

```bash
curl -X PUT '[https://www.bookaway.com/_api/bookings/v2/bookings/69a017f6fbcff655da7891d0/update-in-progress](https://www.bookaway.com/_api/bookings/v2/bookings/69a017f6fbcff655da7891d0/update-in-progress)' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'origin: [https://admin.bookaway.com](https://admin.bookaway.com)' \
  --data-raw '{
    "inProgressBy": "your.email@bookaway.com"
  }'

```

#### Example Request: Release a Booking

Set the `inProgressBy` field to `null` to remove the lock.

```bash
curl -X PUT '[https://www.bookaway.com/_api/bookings/v2/bookings/69a017f6fbcff655da7891d0/update-in-progress](https://www.bookaway.com/_api/bookings/v2/bookings/69a017f6fbcff655da7891d0/update-in-progress)' \
  -H 'Authorization: Bearer <YOUR_ACCESS_TOKEN>' \
  -H 'Content-Type: application/json' \
  -H 'origin: [https://admin.bookaway.com](https://admin.bookaway.com)' \
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