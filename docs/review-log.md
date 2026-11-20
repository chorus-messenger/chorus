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

## Runde 2: Senden, Löschen, Geplantes

| # | Fund | Schwere | Behoben durch |
|---|------|---------|---------------|
| 2.1 | **Getippter Text ging verloren**, wenn das Senden scheiterte, bevor eine Blase im Chat stand (offline, Live-Übersetzung gescheitert, Messenger getrennt). Das Eingabefeld war schon geleert. | hoch | Der Server markiert Fehler, bei denen die „fehlgeschlagen“-Blase schon steht (`shown`). Sonst holt die App den Text zurück ins Eingabefeld. |
| 2.2 | **Geplante Nachricht konnte doppelt gesendet werden:** „Jetzt senden“ sendete zuerst und entfernte den Eintrag erst danach. Lief in der Zeit der Planer (alle 15 s), ging sie zweimal raus. | mittel | Eintrag wird zuerst entfernt. Scheitert das Senden, bevor die Nachricht im Chat steht, kommt er mit Fehlermeldung („Nicht gesendet“) zurück in die Liste. |
| 2.3 | **Selbst gelöschte Fotos/Dateien blieben für immer im Speicher.** Löschen leerte nur die Anhangsliste der Nachricht, die verschlüsselte Datei samt Vorschau blieb liegen. | mittel | Beim Löschen werden die Dateien mit entfernt (nur wenn keine andere Nachricht sie nutzt). |
| 2.4 | Gleiches beim **Verwerfen** einer nie gesendeten Nachricht: Die hochgeladene Datei blieb liegen. | niedrig | Verwerfen löscht Nachricht samt Datei. |
| 2.5 | Bearbeiten erlaubte leeren Text sowie gelöschte oder noch nicht gesendete Nachrichten (führte zu unklaren Fehlern beim Messenger). | niedrig | Server lehnt das mit klarer Meldung ab. |
