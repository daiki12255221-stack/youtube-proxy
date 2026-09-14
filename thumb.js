const axios = require('axios');

module.exports = async (req, res) => {
    const { id } = req.query;
    const url = `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;
    try {
        const response = await axios.get(url, { responseType: 'arraybuffer' });
        res.setHeader('Content-Type', 'image/jpeg');
        res.setHeader('Cache-Control', 's-maxage=86400');
        res.send(response.data);
    } catch (e) {
        res.status(404).send('Not Found');
    }
};
