# Prüfprotokoll (Review-Log)

Drei Prüfrunden vom 20.11.2026. Pro Runde: was aufgefallen ist, wie schwer, wie behoben.

## Runde 1: Anmeldung, Sitzungen, Live-Kanal

| # | Fund | Schwere | Behoben durch |
|---|------|---------|---------------|
| 1.1 | **Passwort ändern ohne altes Passwort.** Wer eine fremde, offene Sitzung hatte (z. B. ein entsperrtes Handy), konnte das Passwort ändern und den Besitzer aussperren. | hoch | Server verlangt das aktuelle Passwort (`oldKey`), mit Login-Bremse und Rate-Limit. Einstellungen haben ein Feld „Aktuelles Passwort“. |
| 1.2 | **Nach Passwortänderung und Wiederherstellung blieben alle anderen Geräte angemeldet**, auch ein mögliches fremdes Gerät. | hoch | Beide beenden jetzt alle anderen Sitzungen des Profils. |
| 1.3 | **Beendete Sitzungen behielten ihren offenen Live-Kanal (WebSocket).** Nach Abmelden, 2FA-Einschalten oder Passwortänderung bekam das abgemeldete Gerät weiter neue Nachrichten in Echtzeit, bis die Verbindung zufällig abriss. | hoch | Jede Live-Verbindung merkt sich ihre Sitzung; beim Beenden einer Sitzung wird sie mit 4401 geschlossen (`dropSessions`). |
| 1.4 | Passwort ändern hatte im Browser keine Fehlerbehandlung: Bei einem Serverfehler passierte sichtbar nichts. | mittel | Fehler werden unter dem Formular angezeigt. |
| 1.5 | `GET /api/chats/:id/messages` gab bei unsinnigem `limit`/`before` (z. B. `NaN`) einen Serverfehler 500. | niedrig | Werte werden geprüft, sonst Standard (60). |
