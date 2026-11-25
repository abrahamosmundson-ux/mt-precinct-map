"""Build data/counties.json (one MultiPolygon per county) from data/precincts.json.
Rasterizes precincts, fills slivers, traces each county's outline. Usage:
  python3 tools/build_counties.py data/precincts.json data/counties.json"""
import json,sys,numpy as np,cv2
from scipy import ndimage
from skimage import measure
fc=json.load(open(sys.argv[1]));fs=fc['features'];R=0.0016
rings=lambda g:[g['coordinates']] if g['type']=='Polygon' else g['coordinates']
xs=[];ys=[]
for f in fs:
  for p in rings(f['geometry']):
    for r in p: a=np.array(r);xs+=[a[:,0].min(),a[:,0].max()];ys+=[a[:,1].min(),a[:,1].max()]
x0,x1,y0,y1=min(xs)-.02,max(xs)+.02,min(ys)-.02,max(ys)+.02
W=int((x1-x0)/R)+1;H=int((y1-y0)/R)+1
counties=sorted({f['properties']['COUNTY'] for f in fs});cid={c:i+1 for i,c in enumerate(counties)}
lab=np.zeros((H,W),np.int32);SH=4
for f in fs:
  v=cid[f['properties']['COUNTY']]
  for p in rings(f['geometry']):
    pts=[(np.stack([(np.array(r)[:,0]-x0)/R,(y1-np.array(r)[:,1])/R],1)*(1<<SH)).round().astype(np.int32) for r in p]
    cv2.fillPoly(lab,[pts[0]],v,shift=SH)
inside=lab>0
state=ndimage.binary_fill_holes(ndimage.binary_closing(inside,np.ones((5,5)),iterations=2))
_,(iy,ix)=ndimage.distance_transform_edt(~inside,return_indices=True)
lab=np.where(state,lab[iy,ix],0)
objs=ndimage.find_objects(lab);out=[]
for c,j in cid.items():
  sl=objs[j-1];oy,ox=sl[0].start,sl[1].start;m=np.pad(lab[sl]==j,1).astype(np.float32)
  polys=[]
  for cn in measure.find_contours(m,0.5):
    if len(cn)<8:continue
    cn=measure.approximate_polygon(cn,0.8)
    polys.append([[[round(x0+(x-1+ox)*R,4),round(y1-(y-1+oy)*R,4)] for y,x in cn]])
  dt=ndimage.distance_transform_edt(m);y,x=np.unravel_index(dt.argmax(),dt.shape)
  out.append({"type":"Feature","properties":{"COUNTY":c,"lx":round(x0+(x-1+ox)*R,4),"ly":round(y1-(y-1+oy)*R,4)},"geometry":{"type":"MultiPolygon","coordinates":polys}})
s=json.dumps({"type":"FeatureCollection","features":out},separators=(',',':'));open(sys.argv[2],'w').write(s)
print(len(out),'counties',len(s)//1024,'KB')
