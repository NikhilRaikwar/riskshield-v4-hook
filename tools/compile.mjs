import fs from "fs";
import path from "path";
import solc from "solc";

const root = process.cwd();
const sources = {};

function collectSolidityFiles(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectSolidityFiles(fullPath);
    } else if (entry.name.endsWith(".sol")) {
      const relative = path.relative(root, fullPath).replaceAll(path.sep, "/");
      sources[relative] = { content: fs.readFileSync(fullPath, "utf8") };
    }
  }
}

for (const dir of ["src", "script"]) {
  collectSolidityFiles(path.join(root, dir));
}

function findImports(importPath) {
  const candidates = [
    path.join(root, importPath),
    path.join(root, "lib", "forge-std", "src", importPath.replace(/^forge-std\//, "")),
    path.join(root, "..", "v4-core", importPath.replace(/^v4-core\//, "")),
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { contents: fs.readFileSync(candidate, "utf8") };
    }
  }

  return { error: `Import not found: ${importPath}` };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "cancun",
    outputSelection: {
      "*": {
        "*": ["abi", "evm.bytecode.object"],
      },
    },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));

if (output.errors) {
  for (const error of output.errors) {
    console.log(`${error.severity}: ${error.formattedMessage}`);
  }

  if (output.errors.some((error) => error.severity === "error")) {
    process.exit(1);
  }
}

fs.rmSync(path.join(root, "out"), { recursive: true, force: true });

for (const [sourceName, contracts] of Object.entries(output.contracts ?? {})) {
  const sourceBaseName = path.basename(sourceName);
  const outputDir = path.join(root, "out", sourceBaseName);
  fs.mkdirSync(outputDir, { recursive: true });

  for (const [contractName, contractOutput] of Object.entries(contracts)) {
    fs.writeFileSync(
      path.join(outputDir, `${contractName}.json`),
      JSON.stringify(
        {
          abi: contractOutput.abi,
          bytecode: contractOutput.evm.bytecode.object,
        },
        null,
        2,
      ),
    );
  }
}

console.log(`Compiled ${Object.keys(output.contracts ?? {}).length} source units successfully.`);
