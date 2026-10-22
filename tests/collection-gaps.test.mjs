import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
const script = resolve("scripts/collect-cities.mjs");
test("gap collection skips old city and completed district pages, retains stores, and resumes without supplier requests", () => {
  const folder = mkdtempSync(join(tmpdir(), "poor-map-gap-"));
  try {
    mkdirSync(join(folder, ".data"));
    writeFileSync(
      join(folder, ".env"),
      "AMAP_WEB_SERVICE_KEY=test\nPLACE_SEARCH_PAUSED=false\n",
    );
    const previous = {
      id: "original",
      name: "好特卖(原店)",
      category: "discount",
      location: [121.55, 29.87],
    };
    writeFileSync(
      join(folder, ".data/city-collection.json"),
      JSON.stringify({
        requests: 0,
        cities: {
          宁波: {
            name: "宁波",
            adcode: "330200",
            stores: { original: previous },
            segments: {
              "discount:好特卖:330200:text": {
                complete: false,
                scanned: true,
                reported: 3,
                received: 1,
              },
              "discount:好特卖:330203:text": {
                complete: true,
                scanned: true,
                reported: 1,
                received: 1,
              },
            },
          },
        },
      }),
    );
    const stub = join(folder, "fetch-stub.mjs");
    writeFileSync(
      stub,
      `import {appendFileSync} from 'node:fs';
    globalThis.fetch=async (url)=>{
      const u=new URL(url);appendFileSync('requests.log',u.pathname+' '+u.searchParams.get('city')+'\\n');
      if(u.pathname==='/v3/config/district')return Response.json({status:'1',districts:[{adcode:'330200',districts:[{adcode:'330201',level:'city',districts:[{adcode:'330203',level:'district'},{adcode:'330205',level:'district'}]}]}]});
      if(u.searchParams.get('city')!=='330205')throw Error('Old city/district search repeated');
      return Response.json({status:'1',count:'1',pois:[{id:'new-store',name:'好特卖(新店)',adcode:'330205',cityname:'宁波市',location:'121.56,29.88',address:'测试地址'}]});
    };`,
    );
    const args = [
      "--import",
      stub,
      script,
      "--cities=宁波",
      "--fill-gaps",
      "--keywords=好特卖",
      "--budget=3",
    ];
    const options = {
      cwd: folder,
      encoding: "utf8",
      env: {
        ...process.env,
        AMAP_WEB_SERVICE_KEY: "test",
        PLACE_SEARCH_PAUSED: "false",
      },
    };
    const interrupted = execFileSync(
      process.execPath,
      args.map((arg) => (arg === "--budget=3" ? "--budget=1" : arg)),
      options,
    );
    assert.match(interrupted, /REQUEST_BUDGET_EXHAUSTED/);
    const partial = JSON.parse(
      readFileSync(join(folder, ".data/city-collection.json")),
    );
    assert.equal(partial.requests, 1);
    assert.deepEqual(partial.cities.宁波.stores, { original: previous });
    execFileSync(process.execPath, args, options);
    let job = JSON.parse(
      readFileSync(join(folder, ".data/city-collection.json")),
    );
    assert.deepEqual(job.cities.宁波.stores.original, previous);
    assert.ok(job.cities.宁波.stores["new-store"]);
    assert.equal(job.requests, 2);
    assert.equal(
      job.cities.宁波.segments["discount:好特卖:330200:text"].complete,
      false,
    );
    assert.equal(
      job.cities.宁波.segments["discount:好特卖:330200:text"].gapExpanded,
      true,
    );
    execFileSync(process.execPath, args, options);
    job = JSON.parse(readFileSync(join(folder, ".data/city-collection.json")));
    assert.equal(job.requests, 2);
    assert.equal(
      readFileSync(join(folder, "requests.log"), "utf8").trim().split("\n")
        .length,
      2,
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("interrupted pagination resumes at the next unread page and preserves saved POIs", () => {
  const folder = mkdtempSync(join(tmpdir(), "poor-map-pages-"));
  try {
    mkdirSync(join(folder, ".data"));
    writeFileSync(
      join(folder, ".env"),
      "AMAP_WEB_SERVICE_KEY=test\nPLACE_SEARCH_PAUSED=false\n",
    );
    const old = Object.fromEntries(
      Array.from({ length: 25 }, (_, i) => [
        "old-" + i,
        {
          id: "old-" + i,
          name: "好特卖(原店" + i + ")",
          category: "discount",
          location: [121.55, 29.87],
        },
      ]),
    );
    writeFileSync(
      join(folder, ".data/city-collection.json"),
      JSON.stringify({
        requests: 0,
        cities: {
          宁波: {
            name: "宁波",
            adcode: "330200",
            stores: old,
            segments: {
              "discount:好特卖:330200:text": {
                complete: false,
                inProgress: true,
                reported: 60,
                received: 25,
                nextPage: 2,
              },
            },
          },
        },
      }),
    );
    const stub = join(folder, "fetch-stub.mjs");
    writeFileSync(
      stub,
      `import{appendFileSync}from'node:fs';globalThis.fetch=async(url)=>{
      const u=new URL(url),page=Number(u.searchParams.get('page'));
      appendFileSync('requests.log',page+'\\n');
      if(![2,3].includes(page))throw Error('Already read page requested');
      return Response.json({status:'1',count:'60',pois:Array.from({length:page===2?25:10},(_,i)=>({id:'new-'+page+'-'+i,name:'好特卖(新店'+page+'-'+i+')',adcode:'330205',cityname:'宁波市',location:'121.56,29.88'}))});
    };`,
    );
    const args = [
      "--import",
      stub,
      script,
      "--cities=宁波",
      "--fill-gaps",
      "--keywords=好特卖",
    ];
    const options = {
      cwd: folder,
      encoding: "utf8",
      env: {
        ...process.env,
        AMAP_WEB_SERVICE_KEY: "test",
        PLACE_SEARCH_PAUSED: "false",
      },
    };
    const output = execFileSync(
      process.execPath,
      [...args, "--budget=1"],
      options,
    );
    assert.match(output, /REQUEST_BUDGET_EXHAUSTED/);
    let job = JSON.parse(
      readFileSync(join(folder, ".data/city-collection.json")),
    );
    assert.equal(Object.keys(job.cities.宁波.stores).length, 50);
    assert.equal(
      job.cities.宁波.segments["discount:好特卖:330200:text"].nextPage,
      3,
    );
    execFileSync(process.execPath, [...args, "--budget=2"], options);
    job = JSON.parse(readFileSync(join(folder, ".data/city-collection.json")));
    assert.equal(Object.keys(job.cities.宁波.stores).length, 60);
    assert.equal(
      job.cities.宁波.segments["discount:好特卖:330200:text"].complete,
      true,
    );
    assert.deepEqual(
      readFileSync(join(folder, "requests.log"), "utf8").trim().split("\n"),
      ["2", "3"],
    );
    assert.deepEqual(job.cities.宁波.stores["old-0"], old["old-0"]);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});

test("per-city request budgets spread collection without exceeding the global cap", () => {
  const folder = mkdtempSync(join(tmpdir(), "poor-map-city-budget-"));
  try {
    mkdirSync(join(folder, ".data"));
    writeFileSync(
      join(folder, ".env"),
      "AMAP_WEB_SERVICE_KEY=test\nPLACE_SEARCH_PAUSED=false\n",
    );
    const cities = {};
    for (const [name, adcode, children] of [
      ["宁波", "330200", ["330203", "330205"]],
      ["北京", "110000", ["110101", "110102"]],
    ])
      cities[name] = {
        name,
        adcode,
        stores: {},
        gapDistricts: { [adcode]: children.map((adcode) => ({ adcode })) },
        segments: {
          ["discount:好特卖:" + adcode + ":text"]: {
            complete: false,
            scanned: true,
            reported: 5,
            received: 1,
          },
        },
      };
    writeFileSync(
      join(folder, ".data/city-collection.json"),
      JSON.stringify({ requests: 0, cities }),
    );
    const stub = join(folder, "fetch-stub.mjs");
    writeFileSync(
      stub,
      `import{appendFileSync}from'node:fs';globalThis.fetch=async(url)=>{
    const u=new URL(url),code=u.searchParams.get('city');appendFileSync('requests.log',code+'\\n');
    if(!['330203','110101'].includes(code))throw Error('Per-city budget bypassed');
    return Response.json({status:'1',count:'1',pois:[{id:'store-'+code,name:'好特卖(测试店)',adcode:code,location:code.startsWith('11')?'116.4,39.9':'121.55,29.87'}]});};`,
    );
    execFileSync(
      process.execPath,
      [
        "--import",
        stub,
        script,
        "--cities=宁波,北京",
        "--fill-gaps",
        "--keywords=好特卖",
        "--budget=2",
        "--per-city-budget=1",
      ],
      {
        cwd: folder,
        env: {
          ...process.env,
          AMAP_WEB_SERVICE_KEY: "test",
          PLACE_SEARCH_PAUSED: "false",
        },
      },
    );
    const job = JSON.parse(
      readFileSync(join(folder, ".data/city-collection.json")),
    );
    assert.equal(job.requests, 2);
    assert.equal(Object.keys(job.cities.宁波.stores).length, 1);
    assert.equal(Object.keys(job.cities.北京.stores).length, 1);
    assert.deepEqual(
      readFileSync(join(folder, "requests.log"), "utf8").trim().split("\n"),
      ["330203", "110101"],
    );
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
