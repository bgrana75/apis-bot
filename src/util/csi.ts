import axios from 'axios';

export async function getUserCsiScore(username: string) {
  try {
    const url = `https://techcoderx.com/curation-api/summary/outgoing/${username}/30/1`;
    const response = await axios.get(url);
    const data = response.data;

    if (!Array.isArray(data)) {
      throw new Error('Invalid CSI data format');
    }

    const score = calcCsi(username, data);
    return score; // { csi, self, total, count }
  } catch (error) {
    console.error(`Error fetching CSI for ${username}:`, error);
    return null;
  }
}

function calcCsi(author: string, summary: any[]) {
  const vote_count = summary.reduce((p, c) => p + c.count, 0);
  const total_weights = summary.reduce((p, c) => p + c.weights, 0);
  const author_idx = summary.findIndex(v => v.author === author);
  const self_vw_total = author_idx > -1 ? summary[author_idx].weights : 0;
  const FULL_WEIGHT = 10000;

  const c = total_weights / FULL_WEIGHT;
  const d = self_vw_total / FULL_WEIGHT;
  const f = d > 0 ? 100 / c * d : 0;
  let g = 1;

  for (let h = 0; h < summary.length; h++) {
    if (summary[h].author !== author) {
      const k = 100 / c * summary[h].weights / FULL_WEIGHT;
      const l = summary[h].count;
      const m = k / 5;
      g = m > 1 ? g - 2.5 * m : g + k;
      if (l < 7) g += 1;
    }
  }

  let a = (100 - f) / 100 * g / 1_000 * c;
  if (f === 0) a += 1;
  else if (parseInt(f.toString()) === 100) a = -0.1 * d;

  return {
    csi: a,
    self: self_vw_total,
    total: total_weights,
    count: vote_count
  };
}
