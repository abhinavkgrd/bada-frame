import * as Sentry from '@sentry/nextjs';
import { getSentryTunnelURL } from 'utils/common/apiUtil';
import { getUserAnonymizedID } from 'utils/user';
import {
    getSentryDSN,
    getSentryENV,
    getSentryRelease,
    getIsSentryEnabled,
} from 'constants/sentry';

const SENTRY_DSN = getSentryDSN();
const SENTRY_ENV = getSentryENV();
const SENTRY_RELEASE = getSentryRelease();
const IS_ENABLED = getIsSentryEnabled();

Sentry.setUser({ id: getUserAnonymizedID() });
Sentry.init({
    dsn: SENTRY_DSN,
    enabled: IS_ENABLED,
    environment: SENTRY_ENV,
    release: SENTRY_RELEASE,
    attachStacktrace: true,
    autoSessionTracking: false,
    tunnel: getSentryTunnelURL(),
    beforeSend(event) {
        event.request = event.request || {};
        const currentURL = new URL(document.location.href);
        currentURL.hash = '';
        event.request.url = currentURL;
        return event;
    },
    integrations: function (i) {
        return i.filter(function (i) {
            return i.name !== 'Breadcrumbs';
        });
    },
    // ...
    // Note: if you want to override the automatic release value, do not set a
    // `release` value here - use the environment variable `SENTRY_RELEASE`, so
    // that it will also get attached to your source maps
});
