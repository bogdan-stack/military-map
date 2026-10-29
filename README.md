# Military Map

A browser mission planner. Drop MIL-STD-2525 and APP-6 symbols on a map, edit affiliation and echelon, draw control measures, and keep the overlay on layers.

Symbology comes from two MIT libraries:

- [milsymbol](https://github.com/spatialillusions/milsymbol) draws the symbols
- [mil-std-2525](https://github.com/spatialillusions/mil-std-2525) supplies the symbol catalogue

```bash
npm install
npm run dev
```

Open http://localhost:3000. The plus button opens the symbol gallery. Click a symbol, then click the map. Right-click a gallery symbol to favorite it. Ctrl+Z undoes a placement.
