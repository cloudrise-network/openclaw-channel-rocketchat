// Local manual test helper.
// DO NOT hardcode credentials in this repo.
//
// Usage:
//   export ROCKETCHAT_BASE_URL='https://your-rocketchat'
//   export ROCKETCHAT_AUTH_TOKEN='...'
//   export ROCKETCHAT_USER_ID='...'
//   node ./test-realtime.mjs

const baseUrl = process.env.ROCKETCHAT_BASE_URL;
const authToken = process.env.ROCKETCHAT_AUTH_TOKEN;
const userId = process.env.ROCKETCHAT_USER_ID;

if (!baseUrl || !authToken || !userId) {
  throw new Error('Missing env: ROCKETCHAT_BASE_URL, ROCKETCHAT_AUTH_TOKEN, ROCKETCHAT_USER_ID');
}

console.log('Base URL:', baseUrl);
console.log('User ID:', userId);
console.log('Auth token set:', authToken ? 'yes' : 'no');

// TODO: call into the library / run your test logic here.
console.log('TODO: implement test logic');
