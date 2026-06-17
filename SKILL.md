# Widget Verification Skill

This skill documents the browser methods exposed on `window` for OTP verification, widget data retrieval, and captcha verification status.

## 4. verifyOtp

The `verifyOtp` method is used to verify an OTP entered by the user.

Method arguments:
- `otp` (string) - mandatory, the OTP value entered by the client.
- `successCallback` (function) - optional, called when verification succeeds.
- `failureCallback` (function) - optional, called when verification fails.
- `reqId` (string) - optional, useful when multiple verification requests occur in the same page/session.

Example:

```js
window.verifyOtp(
  '123456',
  (data) => console.log('OTP verified:', data),
  (error) => console.log(error),
  '336870744532313134323444'
);
```

Note: If you listen to the success and failure callbacks passed to `verifyOtp`, you can skip the `success` and `failure` callbacks provided in the configuration object to avoid duplicate events.

Example configuration:

```js
var configuration = {
  exposeMethods: true,
  success: (data) => {
    // Optional if using verifyOtp callbacks
    console.log('success response', data);
  },
  failure: (error) => {
    // Optional if using verifyOtp callbacks
    console.log('failure reason', error);
  },
};
```

### Browser integration example

```html
<script type="text/javascript">
var configuration = {
  widgetId: "36666d767476303331343035",
  tokenAuth: "528300TO2M2gWEw6a2de204P1",
  identifier: "<enter mobile number/email here> (optional)",
  exposeMethods: true,
  success: (data) => {
    console.log('success response', data);
  },
  failure: (error) => {
    console.log('failure reason', error);
  },
};
</script>
<script type="text/javascript">
(function loadOtpScript(urls) {
  let i = 0;
  function attempt() {
    const s = document.createElement('script');
    s.src = urls[i];
    s.async = true;
    s.onload = () => {
      if (typeof window.initSendOTP === 'function') {
        window.initSendOTP(configuration);
      }
    };
    s.onerror = () => {
      i++;
      if (i < urls.length) {
        attempt();
      }
    };
    document.head.appendChild(s);
  }
  attempt();
})([
  'https://verify.msg91.com/otp-provider.js',
  'https://verify.phone91.com/otp-provider.js'
]);
</script>
```

## 5. getWidgetData

The `getWidgetData` method returns the current configured widget data from the API.

Example:

```js
var widgetData = window.getWidgetData();
console.log('Widget Data:', widgetData);
```

## 6. isCaptchaVerified

The `isCaptchaVerified` method returns a boolean value indicating captcha verification status.

- `true` means captcha verified successfully.
- `false` means not verified or an error occurred during verification.

Example:

```js
var isCaptchaVerified = window.isCaptchaVerified();
console.log('Captcha is verified or not', isCaptchaVerified);
```
