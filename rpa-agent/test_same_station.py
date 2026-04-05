"""Test that same-station dialog dismissal still works (CEB→CEB triggers it)."""

import requests

payload = {
    "bookingId": "test-same-station",
    "reference": "BW-TEST-SAMESTATION",
    "bookingType": "one-way",
    "passengers": [
        {
            "firstName": "Test",
            "lastName": "Passenger",
            "age": "30",
            "gender": "Male",
        }
    ],
    "departureLeg": {
        "origin": "CEB",
        "destination": "CEB",
        "date": "Wed, Apr 8th 2026",
        "time": "6:00 AM",
        "accommodation": "OA",
    },
    "contactInfo": "test@test.com",
}

resp = requests.post(
    "http://localhost:8080/issue-tickets",
    json=payload,
    headers={"Authorization": "Bearer oceanjet-rpa-secret-2026"},
)

print(resp.status_code)
print(resp.json())
