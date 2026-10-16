-- LightMap 0007: a desktop sign-in remembers which network asked for it (a keyed hash of the
-- requester's network prefix, never the address). The approval page compares it with the
-- browser's own: the app and the browser it opens share a network, while a sign-in link sent
-- to someone else (device-code phishing) does not, and then the code must be typed from the
-- app instead of approved from the link.
ALTER TABLE device_links ADD COLUMN IF NOT EXISTS request_net text;
