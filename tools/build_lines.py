import json,re,numpy as np,cv2,sys
from scipy import ndimage
from skimage import measure
fc=json.load(open(sys.argv[1]))
fs=fc['features']
R=0.0016  # degrees per pixel
xs=[];ys=[]
def rings(g):
  return [g['coordinates']] if g['type']=='Polygon' else g['coordinates']
for f in fs:
  for poly in rings(f['geometry']):
    for ring in poly:
      a=np.array(ring);xs+= [a[:,0].min(),a[:,0].max()];ys+=[a[:,1].min(),a[:,1].max()]
x0,x1,y0,y1=min(xs)-.02,max(xs)+.02,min(ys)-.02,max(ys)+.02
W=int((x1-x0)/R)+1;H=int((y1-y0)/R)+1
print(W,H,flush=True)
def topx(ring):
  a=np.array(ring,dtype=np.float64);return np.stack([(a[:,0]-x0)/R,(y1-a[:,1])/R],1)
lab=np.zeros((H,W),np.int32)
SH=4
for i,f in enumerate(fs,1):
  for poly in rings(f['geometry']):
    pts=[(topx(r)*(1<<SH)).round().astype(np.int32) for r in poly]
    cv2.fillPoly(lab,[pts[0]],i,lineType=cv2.LINE_8,shift=SH)
    for h in pts[1:]: cv2.fillPoly(lab,[h],0,shift=SH)
inside=lab>0
# fill small gaps between precincts with nearest precinct
state=ndimage.binary_closing(inside,structure=np.ones((5,5)),iterations=2)
state=ndimage.binary_fill_holes(state)
_,(iy,ix)=ndimage.distance_transform_edt(~inside,return_indices=True)
lab=np.where(state,lab[iy,ix],0)
num=lambda v:(re.findall(r'\d+',str(v or ''))or[''])[0]
STATE=float((lab>0).sum())
def build(keyfn,prefix):
  keys=sorted({keyfn(f['properties']) for f in fs},key=lambda k:(len(k),k))
  idx={k:j+1 for j,k in enumerate(keys)}
  m=np.zeros(len(fs)+1,np.int32)
  for i,f in enumerate(fs,1): m[i]=idx[keyfn(f['properties'])]
  g=m[lab]
  lines=[];labels=[]
  objs=ndimage.find_objects(g)
  for k,j in idx.items():
    sl=objs[j-1] if j-1<len(objs) else None
    if sl is None:continue
    oy,ox=sl[0].start,sl[1].start
    mask=(g[sl]==j)
    p=np.pad(mask,1).astype(np.float32)
    for c in measure.find_contours(p,0.5):
      if len(c)<8:continue
      c=measure.approximate_polygon(c,1.0)
      lines.append([[round(x0+(x-1+ox)*R,4),round(y1-(y-1+oy)*R,4)] for y,x in c])
    dt=ndimage.distance_transform_edt(np.pad(mask,1))
    y,x=np.unravel_index(dt.argmax(),dt.shape)
    labels.append([prefix+(k.lstrip('0') or '0') if prefix else prefix+k,round(float(mask.sum())/STATE,5),round(x0+(x-1+ox)*R,4),round(y1-(y-1+oy)*R,4)])
  return {"lines":lines,"labels":labels}
out={"county":build(lambda p:p['COUNTY'],''),"house":build(lambda p:num(p['HOUSE']),'HD '),"senate":build(lambda p:num(p['SENATE']),'SD ')}
for k,v in out.items(): print(k,len(v['labels']),sum(len(l) for l in v['lines']))
s=json.dumps(out,separators=(',',':'));open(sys.argv[2],'w').write(s);print(len(s)//1024,'KB')
