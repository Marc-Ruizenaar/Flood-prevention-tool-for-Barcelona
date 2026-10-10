# Flood model notebook

A notebook to explore the flood susceptibility model without writing code. Labels come from a physics simulation, trust is low.

**Colab:** put `dataset.csv`, `test_points.csv`, `metrics.json` and `scenarios.json` in My Drive/hackathon-barcelona-flood-model/. Upload `flood_model_colab.ipynb` to Drive (or use File > Upload notebook in Colab). Then Runtime > Run all and allow Drive access. If a file is missing, you are asked to upload it.

**Locally:** `pip install -r ../requirements.txt -r requirements-notebook.txt`, then `jupyter lab` in this folder and Run All. The notebook finds the files in `ml/out/` and `data/ml/`, or in the folder set in `FLOOD_DATA_DIR`.

The first run takes about 2 to 3 minutes. Data files are not copied here.
