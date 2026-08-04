const toggle=document.querySelector('.menu-toggle');
const nav=document.querySelector('.main-nav');
if(toggle){toggle.addEventListener('click',()=>{nav.classList.toggle('active');toggle.setAttribute('aria-expanded',String(nav.classList.contains('active')))})}
document.querySelectorAll('.dropdown>button').forEach(b=>b.addEventListener('click',()=>b.parentElement.classList.toggle('open')));
const observer=new IntersectionObserver(es=>es.forEach(e=>{if(e.isIntersecting)e.target.classList.add('visible')}),{threshold:.12});
document.querySelectorAll('.reveal').forEach(el=>observer.observe(el));

function showMessage(form,text,type='success'){
  let box=form.querySelector('.form-message');
  if(!box){box=document.createElement('div');box.className='form-message';box.setAttribute('role','status');form.appendChild(box)}
  box.className=`form-message ${type}`;box.textContent=text;
}

document.querySelectorAll('form[data-api-form="true"]').forEach(form=>form.addEventListener('submit',async e=>{
  e.preventDefault();
  const button=form.querySelector('button[type="submit"]');
  const original=button?.textContent;
  const data=Object.fromEntries(new FormData(form).entries());
  data.source=form.dataset.source||location.pathname;
  if(!data.interestedCountry&&form.dataset.interest&&form.dataset.interest!=='General')data.interestedCountry=form.dataset.interest;
  if(!data.name||!data.phone){showMessage(form,'Please enter your name and phone number.','error');return}
  try{
    if(button){button.disabled=true;button.textContent='Submitting...'}
    showMessage(form,'Submitting your enquiry...','pending');
    const response=await fetch('/api/enquiries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});
    const result=await response.json();
    if(!response.ok)throw new Error(result.message||'Unable to submit the form.');
    form.reset();showMessage(form,result.message||'Thank you. Our counsellor will contact you soon.','success');
  }catch(error){showMessage(form,error.message||'Submission failed. Please call or WhatsApp us.','error')}
  finally{if(button){button.disabled=false;button.textContent=original}}
}));

const search=document.querySelector('#blogSearch'),cat=document.querySelector('#blogCategory');
function filterBlogs(){if(!search||!cat)return;const q=search.value.toLowerCase(),c=cat.value;document.querySelectorAll('#blogGrid article').forEach(a=>a.classList.toggle('hidden',!(a.innerText.toLowerCase().includes(q)&&(c==='all'||a.dataset.cat===c))))}
if(search){search.addEventListener('input',filterBlogs);cat.addEventListener('change',filterBlogs)}
