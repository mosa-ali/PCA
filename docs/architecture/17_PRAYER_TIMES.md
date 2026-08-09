# 17 — Prayer-Time Architecture

## 1. Goal

Provide reliable, local daily prayer reminders that work even when the PCA server is unavailable.

## 2. Inputs

- latitude/longitude or selected city;
- local time zone;
- date;
- prayer calculation method;
- Asr juristic method;
- high-latitude handling where relevant;
- per-prayer manual minute adjustment.

## 3. Outputs

- Fajr;
- Sunrise;
- Dhuhr;
- Asr;
- Maghrib;
- Isha.

## 4. Calculation choices

PCA exposes common recognized calculation conventions as named options rather than silently choosing one globally. Parent can select the local/preferred method and adjust minutes.

## 5. Reminder modes

- notification at prayer time;
- optional advance reminder;
- optional Adhan/audio subject to OS background/audio rules;
- vibration/silent option;
- Arabic/English display independently per device.

## 6. Offline behavior

Prayer times are calculated locally from stored location/time-zone settings. If location becomes stale after travel, PCA warns that prayer times may need location refresh.

## 7. School/quiet modes

Prayer reminders can remain permitted while entertainment apps are restricted. Audio respects silent/Do Not Disturb/platform behavior and parent configuration.
