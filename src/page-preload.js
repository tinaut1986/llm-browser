// Se ejecuta en cada pestaña antes que los scripts de la página.
// Electron no tiene interfaz de passkeys/WebAuthn: credentials.get() espera para siempre y el login se queda colgado.
// Se rechazan al instante como si el usuario las cancelara, y se declara que no hay soporte, para que la web use la contraseña.
const { webFrame } = require('electron');
webFrame.executeJavaScript(`(() => {
  if (typeof PublicKeyCredential === 'undefined') return;
  const deny = () => Promise.reject(new DOMException('The operation either timed out or was not allowed.', 'NotAllowedError'));
  for (const m of ['get', 'create']) {
    const orig = CredentialsContainer.prototype[m];
    CredentialsContainer.prototype[m] = function (o) { return o && o.publicKey ? deny() : orig.call(this, o); };
  }
  PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable = () => Promise.resolve(false);
  PublicKeyCredential.isConditionalMediationAvailable = () => Promise.resolve(false);
})()`);
