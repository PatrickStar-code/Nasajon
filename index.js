require("dotenv").config({ path: ".env.development" });
const fs = require("fs");
const Papa = require("papaparse");
const fetch = require("node-fetch");

async function signup(email, password) {
  try {
    const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ email, password }),
    });
    return await response.json();
  } catch (err) {
    console.log(err);
  }
}

async function login(email, password) {
  try {
    const response = await fetch(
      `${process.env.SUPABASE_URL}/auth/v1/token?grant_type=password`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: process.env.SUPABASE_ANON_KEY,
        },
        body: JSON.stringify({ email, password }),
      },
    );
    return await response.json();
  } catch (err) {
    console.log(err);
  }
}

async function getDataforIBGE() {
  try {
    const response = await fetch(process.env.IBGE_URL);
    return await response.json();
  } catch (err) {
    console.log(err);
    return [];
  }
}

function readCSV(path) {
  const file = fs.readFileSync(path, "utf-8");
  const parsed = Papa.parse(file, { header: true, skipEmptyLines: true });
  return parsed.data.map((row) => ({
    municipio_input: row.municipio.trim(),
    populacao_input: Number(row.populacao),
  }));
}

function normalize(text) {
  return text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

async function sendResponse(data) {
  try {
    const response = await fetch(process.env.PROJECT_FUNCTION_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: process.env.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${process.env.ACCESS_TOKEN}`,
      },
      body: JSON.stringify(data),
    });
    return await response.json();
  } catch (err) {
    console.log(err);
  }
}

async function main() {
  const dataIBGE = await getDataforIBGE();
  const cities = [];
  const errors = [];

  for (const city of dataIBGE) {
    if (!city.microrregiao?.mesorregiao?.UF) errors.push(city);
    else
      cities.push({
        name: city.nome,
        uf_nome: city.microrregiao.mesorregiao.UF.nome,
        uf_sigla: city.microrregiao.mesorregiao.UF.sigla,
        region: city.microrregiao.mesorregiao.UF.regiao.nome,
        codeIBGE: city.id,
      });
  }

  const input = readCSV("input.csv");
  const results = [];
  let total_ok = 0;
  let total_nao_encontrado = 0;
  let total_erro_api = 0;
  let pop_total_ok = 0;
  const regiaoSum = {};
  const regiaoCount = {};

  for (const row of input) {
    try {
      const normalizedInput = normalize(row.municipio_input);
      const matches = cities.filter(
        (c) => normalize(c.name) === normalizedInput,
      );

      if (matches.length === 0) {
        total_nao_encontrado++;
        results.push({ ...row, status: "NAO_ENCONTRADO" });
        continue;
      }

      if (matches.length > 1) {
        results.push({ ...row, status: "AMBIGUO" });
        continue;
      }

      const c = matches[0];
      total_ok++;
      pop_total_ok += row.populacao_input;

      if (!regiaoSum[c.region]) {
        regiaoSum[c.region] = 0;
        regiaoCount[c.region] = 0;
      }

      regiaoSum[c.region] += row.populacao_input;
      regiaoCount[c.region]++;

      results.push({
        ...row,
        municipio_ibge: c.name,
        uf: c.uf_sigla,
        regiao: c.region,
        id_ibge: c.codeIBGE,
        status: "OK",
      });
    } catch {
      total_erro_api++;
      results.push({ ...row, status: "ERRO_API" });
    }
  }

  const header =
    "municipio_input,populacao_input,municipio_ibge,uf,regiao,id_ibge,status";
  const lines = results.map((r) =>
    [
      r.municipio_input,
      r.populacao_input,
      r.municipio_ibge || "",
      r.uf || "",
      r.regiao || "",
      r.id_ibge || "",
      r.status,
    ].join(","),
  );

  fs.writeFileSync("resultado.csv", [header, ...lines].join("\n"));

  const medias_por_regiao = {};
  for (const r in regiaoSum)
    medias_por_regiao[r] = regiaoSum[r] / regiaoCount[r];

  const stats = {
    total_municipios: input.length,
    total_ok,
    total_nao_encontrado,
    total_erro_api,
    pop_total_ok,
    medias_por_regiao,
  };

  const responseAPI = await sendResponse({ stats });
  //console.log("Resposta da API:", responseAPI);
}

main();
