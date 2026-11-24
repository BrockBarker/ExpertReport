#!/usr/bin/env python3
import json, re, sys
la_rows_path, price_text_path, out_dir = sys.argv[1:4]

# ---------- species factors (rows come from the source PDF text, not from the screenshot) ----------
rows = [(a.strip(), float(b)) for a, b in json.load(open(la_rows_path))]
common = {
 'Acer negundo': 'boxelder', 'Acer platanoides': 'Norway maple', 'Acer rubrum': 'red maple', 'Acer saccharinum': 'silver maple',
 'Acer saccharum': 'sugar maple', 'Aesculus glabra': 'Ohio buckeye', 'Aesculus hippocastanum': 'horse chestnut',
 'Ailanthus altissima': 'tree of heaven', 'Betula nigra': 'river birch', 'Carya alba': 'mockernut hickory', 'Carya aquatica': 'water hickory',
 'Carya cordiformis': 'bitternut hickory', 'Carya glabra': 'pignut hickory', 'Carya illinoinensis': 'pecan', 'Carya ovata': 'shagbark hickory',
 'Cedrus atlantica': 'Atlas cedar', 'Cedrus deodara': 'deodar cedar', 'Celtis laevigata': 'sugarberry', 'Celtis occidentalis': 'common hackberry',
 'Cryptomeria japonica': 'Japanese cedar', 'Fagus grandifolia': 'American beech', 'Fagus sylvatica': 'European beech',
 'Fraxinus americana': 'white ash', 'Fraxinus pennsylvanica': 'green ash', 'Ginkgo biloba': 'ginkgo', 'Gleditsia triacanthos': 'honeylocust',
 'Juglans nigra': 'black walnut', 'Juniperus virginiana': 'eastern redcedar', 'Liquidambar styraciflua': 'sweetgum',
 'Liriodendron tulipifera': 'tulip poplar', 'Magnolia acuminata': 'cucumber tree', 'Magnolia grandiflora': 'southern magnolia',
 'Nyssa sylvatica': 'black gum', 'Pinus echinata': 'shortleaf pine', 'Pinus elliottii': 'slash pine', 'Pinus palustris': 'longleaf pine',
 'Pinus strobus': 'eastern white pine', 'Pinus taeda': 'loblolly pine', 'Platanus occidentalis': 'American sycamore',
 'Populus deltoides': 'eastern cottonwood', 'Populus heterophylla': 'swamp cottonwood', 'Prunus serotina': 'black cherry',
 'Quercus alba': 'white oak', 'Quercus coccinea': 'scarlet oak', 'Quercus falcata': 'southern red oak', 'Quercus imbricaria': 'shingle oak',
 'Quercus laurifolia': 'laurel oak', 'Quercus lyrata': 'overcup oak', 'Quercus macrocarpa': 'bur oak', 'Quercus marilandica': 'blackjack oak',
 'Quercus michauxii': 'swamp chestnut oak', 'Quercus nigra': 'water oak', 'Quercus palustris': 'pin oak', 'Quercus phellos': 'willow oak',
 'Quercus rubra': 'northern red oak', 'Quercus shumardii': 'Shumard oak', 'Quercus stellata': 'post oak', 'Quercus velutina': 'black oak',
 'Quercus virginiana': 'live oak', 'Robinia pseudoacacia': 'black locust', 'Salix nigra': 'black willow',
 'Salix x sepulcralis Simonkai': 'weeping willow', 'Taxodium distichum': 'bald cypress', 'Tilia cordata': 'littleleaf linden',
 'Tsuga canadensis': 'eastern hemlock', 'Ulmus alata': 'winged elm', 'Ulmus americana': 'American elm', 'Ulmus crassifolia': 'cedar elm',
 'Ulmus glabra': 'Wych elm', 'Ulmus parvifolia': 'Chinese elm', 'Ulmus procera': 'English elm', 'Ulmus pumila': 'Siberian elm',
 'Ulmus rubra': 'slippery elm', 'Ulmus serotina': 'September elm', 'Ulmus thomasii': 'rock elm'}
missing = [s for s, _ in rows if s not in common]
assert not missing, missing
assert len(rows) == 75 and len(set(s for s, _ in rows)) == 75
species = {
 'what': 'Species factors for Louisiana, for use as the species rating in the 9th-edition Trunk Formula Method.',
 'chosen_by': 'Supplied by the arborist on 2026-11-12 as the species ratings to use for 9th-edition appraisals.',
 'source': {
   'citation': 'Nowak, David J. 2024. Understanding i-Tree: Summary of programs and methods. Gen. Tech. Rep. NRS-200-2023. Madison, WI: U.S. Department of Agriculture, Forest Service, Northern Research Station. Appendix 7: Compensatory Value of Trees, Table 15 (LA), p. 29.',
   'doi': 'https://doi.org/10.2737/NRS-GTR-200-2023-Appendix7',
   'url': 'https://www.fs.usda.gov/nrs/pubs/gtr/gtr-nrs200-2023_appendixes/gtr_nrs200-2023_appendix7.pdf',
   'what_the_source_says': 'Compensatory value is estimated using Council of Tree and Landscape Appraisers (CTLA 1992) guidelines. The species rating is a number between 0 and 1.00, where 1.00 is the most desirable, and may differ from state to state. The factors were compiled from numerous states for i-Tree Eco. The appendix does not name the publication the Louisiana ratings were taken from.',
   'checked': 'All 75 rows read from the PDF text on 2026-11-12 and compared with the arborist\'s screenshot: identical.'},
 'louisiana_base_values_from_same_source': {
   'table': 'Table 19, Base dollar values for the United States in U.S. dollars (2000), p. 102',
   'base_value_usd_per_sq_in': 16.26, 'replacement_cost_usd': 940.00, 'maximum_transplant_size_in': 6.0,
   'note': 'Year-2000 dollars. Reference only; not used unless the arborist chooses it.'},
 'common_names_note': 'Common names were added for look-up and are not from the source. Check them before they appear in a report.',
 'species': [{'scientific': s, 'common': common[s], 'factor': f} for s, f in rows]}
json.dump(species, open(out_dir + '/species-factors-louisiana.json', 'w'), indent=1, ensure_ascii=False)

# ---------- price sheet (rows read from the page images, prices cross-checked against the PDF text) ----------
L = True
sheet = [
 ('Crepe Myrtle', [
  ("'Muskogee'", '30 gal', "8-10' x 4-5'", None, 'MT - Lavender Pink', 95, False), ("'Muskogee'", '45 gal', "8-10' x 5-6'", None, 'MT - Lavender Pink', 175, False),
  ("'Muskogee'", '65 gal', "10-12' x 2-3'", '2 - 2 1/2', 'ST - Lavender Pink', 300, False), ("'Natchez'", '30 gal', "8-10' x 4-5'", None, 'MT - White', 95, False),
  ("'Natchez'", '45 gal', "8-10' x 5-6'", None, 'MT - White', 175, False), ("'Natchez'", '65 gal', "10-12' x 2-3'", '2 - 2 1/2', 'ST - White', 300, L),
  ("'Scarlet'", '30 gal', "6-8' x 3-4'", None, 'MT - Red', 110, L), ("'Scarlet'", '30 gal', "8-10' x 2-3'", '1 - 1 1/2', 'ST - Red', 150, L),
  ("'Scarlet'", '65 gal', "9-10' x 3-4'", '1 1/2 - 2', 'ST - Red', 300, L), ("'Tuscarora'", '30 gal', "6-8' x 2-3'", None, 'MT - Dark Pink', 95, L),
  ("'Tuscarora'", '30 gal', "8-9' x 2-3'", '1 - 1 1/2', 'ST - Dark Pink', 150, L), ("'Twilight'", '30 gal', "6-8' x 2-3'", None, 'MT - Purple', 95, False)]),
 ('Cypress / Conifers', [
  ("Arborvitae 'Green Giant'", '15 gal', "3-4' x 12-18\"", None, 'Nice', 55, L), ("Arborvitae 'Green Giant'", '30 gal', "5-6' x 2-3'", None, 'Nice', 95, False),
  ('Cypress, Bald', '30 gal', "7-8' x 2-3'", '2 - 2 1/2', 'Nice', 100, False), ('Cypress, Bald', '65 gal', "10-12' x 5-6'", '3 - 3 1/2', 'Nice', 260, False),
  ('Cypress, Pond', '30 gal', "8-10' x 2-3'", '1 1/2 - 2', 'Nice', 120, False), ('Cypress, Pond', '65 gal', "10-12' x 3-4'", '2 1/2 - 3', 'Nice', 300, False),
  ("Juniper Taylor's", '15 gal', "3-4' x 8-10\"", None, 'Italian Substitute - Young', 100, L), ("Juniper Taylor's", '30 gal', "4-5' x 8-10\"", None, 'Italian Substitute - Young', 200, L)]),
 ('Holly', [
  ('Acadiana', '15 gal', "2-3' x 1-2'", None, 'FTG - Nice', 75, False), ('Acadiana', '30 gal', "5-6' x 18-24\"", None, 'FTG - Nice', 120, False),
  ('Alpha Male', '30 gal', "7-8' x 1-2\"", '1 1/2 - 2', 'ST - Nice Never Berries', 150, L), ('Eagleston', '30 gal', "7-8' x 2-3'", '1 1/2 - 1 3/4', 'ST', 185, False),
  ('Eagleston', '65 gal', "8-9' x 3-4'", '2 - 2 1/2', 'ST', 385, L), ('East Palatka', '30 gal', "7-8' x 2-3'", '1 1/2 - 1 3/4', 'ST', 185, False),
  ('Needle Point', '30 gal', "4-5' x 2-3'", None, 'FTG', 100, False), ('Oakland', '15 gal', "2-3' x 1-2'", None, 'FTG - Nice', 75, False),
  ('Oakland', '30 gal', "5-6' x 2-3'", None, 'FTG - Nice', 120, L), ('Patio Jewel', '30 gal', "7-8' x 1-2'", '1 1/2 - 1 3/4', 'ST - Nice', 150, False),
  ('Sky Pencil', '15 gal', "4-5' x 10-12\"", None, 'Nice', 60, False), ('Pride of Houston', '30 gal', "5-6' x 2-3'", None, 'Nice', 120, L)]),
 ('Magnolia', [
  ("Grandiflora 'Alta'", '15 gal', "4-5' x 18-24\"", None, 'FTG - Nice', 75, False),
  ("Grandiflora 'Brackens Brown Beauty'", '15 gal', "3-4' x 1-2'", None, 'FTG - Young', 60, False), ("Grandiflora 'Brackens Brown Beauty'", '30 gal', "7-8' x 2-3'", None, 'FTG - Nice', 120, False),
  ("Grandiflora 'Brackens Brown Beauty'", '45 gal', "8-9' x 3-4'", None, 'FTG - Nice', 200, False), ("Grandiflora 'Brackens Brown Beauty'", '65 gal', "9-10' x 3-4'", None, 'FTG', 300, L),
  ("Grandiflora 'Claudia Wannamaker'", '15 gal', "5-6' x 18-24\"", None, 'FTG - Nice', 60, False), ("Grandiflora 'Claudia Wannamaker'", '30 gal', "7-8' x 2-3'", None, 'FTG - Nice', 120, False),
  ("Grandiflora 'Claudia Wannamaker'", '45 gal', "8-9' x 3-4'", None, 'FTG', 200, L), ("Grandiflora 'Claudia Wannamaker'", '65 gal', "9-10' x 3-4'", None, 'FTG', 300, L),
  ("Grandiflora 'DD Blanchard'", '30 gal', "7-8' x 2-3'", None, 'ST or FTG', 120, False), ("Grandiflora 'DD Blanchard'", '45 gal', "8-9' x 2-3'", '2 - 2 1/2', 'ST or FTG', 200, L),
  ("Grandiflora 'DD Blanchard'", '65 gal', "9-10' x 3-4'", None, 'FTG', 300, L),
  ("Grandiflora 'Kay Parris'", '15 gal', "3-4' x 1-2'", None, 'FTG', 60, False), ("Grandiflora 'Kay Parris'", '30 gal', "5-6' x 2-3'", None, 'FTG - Nice', 120, False),
  ("Grandiflora 'Kay Parris'", '45 gal', "9-10' x 2-3'", None, 'FTG - Nice', 200, L),
  ("Grandiflora 'Little Gem'", '15 gal', "2-3' x 1-2'", None, 'FTG', 60, False), ("Grandiflora 'Little Gem'", '30 gal', "5-6' x 2-3'", None, 'FTG - Nice', 120, False),
  ("Grandiflora 'Little Gem'", '45 gal', "7-8' x 2-3'", None, 'FTG - Nice', 200, False),
  ("Virginiana 'Ev. Sweet Bay'", '30 gal', "6-8' x 2-3'", None, 'MT - Young', 120, False), ("Virginiana 'Ev. Sweet Bay'", '30 gal', "6-8' x 2-3'", '1 - 1 1/2', 'ST', 140, False),
  ("Virginiana 'Ev. Sweet Bay'", '65 gal', "9-10' 3-4'", None, 'MT - Nice', 300, L), ('Japanese Jane', '65 gal', "6-7' x 2-3'", None, 'MT - Nice', 350, False)]),
 ('Maple', [
  ("Swamp 'Drummond'", '30 gal', "8-10' x 3-4'", '1 1/2 - 2', 'Nice', 100, False), ("Swamp 'Drummond'", '65 gal', "12-14' x 5-6'", '2 1/2 - 3', 'Nice', 260, L),
  ("Swamp 'Summer Red'", '30 gal', "8-9' x 3-4'", '1 1/2 - 1 3/4', 'Nice', 120, False), ("Swamp 'Summer Red'", '65 gal', "10-12' x 5-6'", '2 - 2 1/2', 'Nice', 275, L)]),
 ('Oaks', [
  ("Live 'Cajun'", '15 gal', "6-8' x 2-3'", '1 1/2 - 2', 'Nice', 75, L), ("Live 'Cajun'", '30 gal', "8-10' x 3-4'", '1 1/2 - 2', 'Nice', 120, False),
  ("Live 'Cajun'", '45 gal', "10-12' x 3-4'", '2 - 2 1/2', 'Nice', 200, False), ("Live 'Cajun'", '200 gal', "14-16' x 8-10'", '4 - 4 1/2', 'Nice', 1500, False),
  ("Live 'Joan Lionetti'", '30 gal', "8-9' x 2-3'", '2 - 2 1/2', 'Nice - Cutting Grown', 140, False),
  ('Nuttall', '30 gal', "8-9' x 3-4'", '1 1/2 - 2', 'Nice', 100, False), ('Nuttall', '65 gal', "10-12' x 4-6'", '2 1/2 - 2 3/4', 'Nice', 275, False),
  ('Shumard', '15 gal', "6-8' x 2-3'", '1 - 1 1/2', 'Nice', 60, L), ('Shumard', '30 gal', "8-9' x 2-3'", '1 1/2 - 2', 'Nice', 120, False),
  ('Shumard', '65 gal', "10-12' x 4-6'", '2 1/2 - 2 3/4', 'Nice', 275, False),
  ('Willow', '30 gal', "8-9' x 2-3'", '1 1/2 - 2', 'Nice', 120, False), ('Willow', '65 gal', "12-14' x 4-5'", '2 1/2 - 3', 'Nice', 275, False)]),
 ('Miscellaneous', [
  ('Chinese Fringe', '30 gal', "6-7' x 2-3'", '1 - 1 1/2', 'ST - Young', 150, L), ('Chinese Fringe', '65 gal', "7-8' x 3-4'", '2 - 2 1/2', 'ST - Nice', 385, L),
  ("Elm 'Allee'", '30 gal', "8-10' x 3-4'", '1 1/2 - 1 3/4', 'Nice', 120, False), ("Elm 'Drake'", '30 gal', "8-10' x 4-5'", '1 1/2 - 1 3/4', 'Nice', 120, False),
  ("Elm 'Drake'", '65 gal', "12-14' x 5-6'", '2 - 2 1/2', 'Nice', 300, L), ('Japanese Yew', '30 gal', "5-6' x 2-3'", None, 'Nice', 175, False),
  ('Sweet Gum Slender Silhouette', '30 gal', "8-10' x 1-2'", '2 - 2 1/4', 'Nice', 140, False),
  ("Vitex Shoal's Creek", '30 gal', "4-5' x 3-4'", None, 'MT - Nice', 120, False), ('Vitex Le Compte', '30 gal', "6-8' x 4-5'", None, 'MT - Nice - Lacy Leaf', 120, False)])]

def frac(s):  # '2 1/2' -> 2.5
    tot = 0.0
    for part in s.split():
        if '/' in part: a, b = part.split('/'); tot += float(a) / float(b)
        else: tot += float(part)
    return tot
items = []
for cat, rws in sheet:
    for variety, container, hs, cal, comments, price, ltd in rws:
        it = {'category': cat, 'variety': variety, 'container': container, 'height_x_spread': hs, 'comments': comments, 'price_usd': price, 'limited': bool(ltd)}
        if cal:
            lo, hi = [frac(x.strip()) for x in cal.split(' - ')]
            it.update({'caliper_in': cal, 'caliper_min_in': lo, 'caliper_max_in': hi})
        items.append(it)
# cross-check: the sequence of prices (and LTD marks) must equal the sequence in the PDF's own text
txt = open(price_text_path).read()
found = [(int(a.replace(',', '')), bool(b)) for a, b in re.findall(r'\$\s?([\d,]+)( LTD)?', txt)]
mine = [(i['price_usd'], i['limited']) for i in items]
print('price rows transcribed:', len(mine), '| prices in PDF text:', len(found), '| sequences identical:', mine == found)
if mine != found:
    for n, (a, b) in enumerate(zip(mine, found)):
        if a != b: print('  first difference at row', n, a, b, items[n]); break
out = {
 'supplier': 'Gerald Foret Wholesale Nursery, Inc.', 'address': '4214 Forrest LeBlanc Road, New Iberia, LA 70560',
 'title': 'March - April 2025 Availability', 'price_basis': 'Wholesale price per plant as printed. Does not include delivery, planting or guarantee.',
 'source_file': 'Bobs Tree Preservation/appraisal price sheets/FINAL March-April 2025_.0625B (005).pdf',
 'legend': {'FTG': 'Full to Ground', 'MT': 'Multi Trunk', 'ST': 'Single Trunk', 'LTD': 'limited quantity (as marked on the sheet)'},
 'notes': 'Sizes are container size, height x spread, and trunk caliper in inches where the sheet gives one. One holly row prints its spread as 1-2 inches (7-8\' x 1-2"), copied as printed. Prices subject to change without notice, per the sheet.',
 'checked': 'Rows read from the page images on 2026-11-12; all 79 prices and LTD marks match the PDF text in order.',
 'items': items}
json.dump(out, open(out_dir + '/price-sheets/gerald-foret-2025-03.json', 'w'), indent=1, ensure_ascii=False)
print('species rows:', len(species['species']), '| largest caliper on sheet:', max(i.get('caliper_max_in', 0) for i in items))
