// Run with: node api/_lib/vale/mailer.test.js
const assert = require('assert');
const { sendBrief } = require('./mailer');

let pass = 0, fail = 0;
async function test(name, fn) {
  try { await fn(); pass++; console.log('  PASS ', name); }
  catch (e) { fail++; console.log('  FAIL ', name, '\n        ', e.message); }
}

const CFG = { tenantId: 't', clientId: 'c', clientSecret: 's', senderAddress: 'vale@ambientpixels.ai' };
function fakeFetch(tokenBody, sendStatus) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, init });
    if (url.indexOf('/oauth2/v2.0/token') !== -1) return { status: tokenBody.access_token ? 200 : 400, json: async () => tokenBody };
    return { status: sendStatus, text: async () => 'detail' };
  };
  f.calls = calls;
  return f;
}

(async () => {
  await test('uses client credentials, sends from vale@ to the recipient', async () => {
    const f = fakeFetch({ access_token: 'APP' }, 202);
    await sendBrief({ cfg: CFG, fetch: f }, { to: 'chad@ambientpixels.ai', subject: 'Vale brief', html: '<p>hi</p>' });
    assert.ok(/grant_type=client_credentials/.test(f.calls[0].init.body));
    assert.strictEqual(f.calls[1].url, 'https://graph.microsoft.com/v1.0/users/vale%40ambientpixels.ai/sendMail');
    const body = JSON.parse(f.calls[1].init.body);
    assert.strictEqual(body.message.toRecipients[0].emailAddress.address, 'chad@ambientpixels.ai');
    assert.strictEqual(f.calls[1].init.headers.Authorization, 'Bearer APP');
  });
  await test('the sender can never come from the message', async () => {
    const f = fakeFetch({ access_token: 'APP' }, 202);
    await sendBrief({ cfg: CFG, fetch: f }, { to: 'chad@ambientpixels.ai', from: 'chad@ambientpixels.ai', subject: 's', html: 'h' });
    assert.ok(f.calls[1].url.indexOf('/users/vale%40ambientpixels.ai/') !== -1);
  });
  await test('a non-202 response throws', async () => {
    await assert.rejects(sendBrief({ cfg: CFG, fetch: fakeFetch({ access_token: 'APP' }, 403) }, { to: 'x@y.z', subject: 's', html: 'h' }), /sendMail 403/);
  });
  await test('a token failure throws before any send', async () => {
    const f = fakeFetch({ error: 'unauthorized_client' }, 202);
    await assert.rejects(sendBrief({ cfg: CFG, fetch: f }, { to: 'x@y.z', subject: 's', html: 'h' }), /app token failed/);
    assert.strictEqual(f.calls.length, 1);
  });
  await test('no sender configured → refuses', async () => {
    await assert.rejects(sendBrief({ cfg: Object.assign({}, CFG, { senderAddress: '' }), fetch: fakeFetch({}, 202) }, { to: 'x', subject: 's', html: 'h' }), /no sender/);
  });

  console.log(`\n${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
})();
