module.exports = async function (context, req) {
    // Hardcoded for now—replace with real logic (e.g., generate JWT)
    const token = 'test-token-123';
    context.res = {
        status: 200,
        body: { token: token }
    };
};